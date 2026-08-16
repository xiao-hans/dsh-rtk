# @dsh-external/dsh-rtk

DSH 的 RTK 薄适配插件：不 fork RTK，只做 DSH 侧的接入层。

仓库：https://github.com/xiao-hans/dsh-rtk

## 功能

- 自动改写 `pwsh` 命令：常见命令自动变成 `rtk ...`。
- 提供专用 `rtk` 工具，模型可以直接调用。
- Windows/PowerShell 兼容映射：`ls` / `dir` / `cat` / `type` 等自动映射到 RTK 可用命令。
- 将 RTK 统计数据库重定向到 `$DSH_HOME/storages/rtk-history.db`，避免 sandbox 拒绝访问；主路径不可写时在命令层探测并自动回退到 `$env:TEMP`。
- 注入 DSH system prompt，指导模型优先使用 RTK。

## 当前状态

- 已安装进 DSH `desktop`（以及 `web`）profile；`pwsh` 会受 agent preset 作用域遮蔽，为此在 `agent/created` 时把 RTK 版 `pwsh` 注册到每个 agent 自己的作用域，避免修改任何 preset 文件。
- 已通过 `headless` 无头会话做端到端验证：真实模型在带 preset 组合的 agent 中调用 `pwsh("ls")`，执行结果携带 RTK 二进制专属的 `[rtk]` 提示行，确认 RTK 版 `pwsh` 胜出并自动改写走 RTK（详见下文「端到端验证」）。
- 前台执行已支持；后台任务（`run_in_background`）暂未实现，后续可补。
- sandbox 升级字段（`sandbox_permissions` / `justification`）暂未实现；命令在 DSH 当前 sandbox 模式下执行。

## 安装

在 `~/.dsh/profiles/<profile>/package.json` 中加入依赖，并把本包加入 `dsh.profile.bundles`：

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@dsh-external/dsh-rtk"
      ]
    }
  },
  "dependencies": {
    "@dsh-external/dsh-rtk": "link:D:/HANXIAO/Documents/dsh-rtk"
  }
}
```

然后：

```bash
dsh plugin --profile web install
```

## 端到端验证（headless）

用无头 profile 跑一条一次性任务，可在真实 DSH（真实模型）中验证 `pwsh` 自动改写是否走 RTK：

1. 建 `~/.dsh/profiles/headless/package.json`（模板为 `dsh-base` + `dsh-headless`，叠加本插件）：

```json
{
  "name": "dsh-profile-headless",
  "private": true,
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-headless",
        "@dsh-external/dsh-rtk"
      ]
    }
  },
  "dependencies": {
    "@dsh-external/dsh-rtk": "link:D:/HANXIAO/Documents/dsh-rtk"
  }
}
```

并在 `~/.dsh/profiles/headless/node_modules/@dsh-external/` 下把 `dsh-rtk` 链接到本目录。

2. 在**带模型凭据的 shell**（如 `OPENCODE_GO_API_KEY`）里运行（务必从一个**不在系统 Temp 下**的目录运行，否则 Windows ACL 沙箱会因「temp root 必须在 workspace 之外」拒绝执行）：

```bash
cd /path/to/dsh-rtk
dsh --profile headless "用 pwsh 工具执行命令 ls，逐字告诉我你传入的确切命令字符串与输出"
```

3. 判定：若模型返回的 stderr 含 RTK 专属横幅 `[rtk] /!\ No hook installed — run rtk init -g`，说明执行走的是 RTK 二进制（原生 pwsh 绝无此输出）——RTK 版 `pwsh` 在 agent 作用域胜出并自动改写成功。

> 已实测通过：`dsh --profile headless "…"` 中模型调用 `pwsh("ls")`，目录列表输出 + `[rtk]` 横幅，确认走 RTK。

## 已知的 RTK 本体行为（薄层不改写）

本插件是薄层，不重写 RTK 的过滤/变形逻辑；以下行为来自 RTK 二进制本身，实测复现：

- `ls` / `dir` → 变形成 `find`；PowerShell 专属参数（如 `-ErrorAction`）会被忽略。
- `cat` / `type` → 变形成外部 `read`；需要 RTK 的 `read` 后端，某些环境找不到时命令失败。
- PowerShell 内建/别名（`echo`、`pwd`、`clear`、`Get-ChildItem` 等）不是可执行文件，`rtk` 工具会报 `Binary 'xxx' not found`；这类命令应走 `pwsh` 工具（`pwsh` 会保持原生执行）。
- `rtk config` / `rtk init` / `rtk gain` / `rtk rewrite` 等命令直接透传给 RTK（`rtk status` 并非有效子命令，真实命令表见 `rtk --help`）。

薄层在以下边界会**回退到原生 PowerShell**（不交给 RTK，避免语义被破坏）：

- 复合/管道命令（含 `|`、`;`、`&&`、`||`、重定向或换行），如 `ls -la | Select-Object -First 3`——整行改写给 rtk 会吞掉管道。
- `cat` / `type` 带 PowerShell 专属开关（`-TotalCount` / `-Tail` / `-Raw` 等），如 `cat file.json -TotalCount 3`——rtk read 不认这些参数。
- RTK 历史库主路径（`$DSH_HOME/storages`）在沙箱内不可写时，自动回退到 `$env:TEMP\rtk-history.db` 保证 tracking 可用。

## 测试

```bash
npm test
```

在禁止子进程派生的沙箱内，测试需以单进程隔离模式运行（`npm test` 已默认带上）：

```bash
node --test --experimental-test-isolation=none tests/rewrite.test.mjs tests/integration.test.mjs tests/schema.test.mjs
```
