# dsh-rtk

**基于 RTK、专为 DSH 打造的薄层适配插件**：让 DSH 的 AI agent 在 Windows/PowerShell 里**自动用 RTK 压缩命令输出、节省 token**。

> 定位：本插件不 fork、不修改 RTK——RTK 是底层能力提供者，本插件只是把 RTK 接进 DSH 的接入层。

- 仓库：https://github.com/xiao-hans/dsh-rtk
- 版本：v0.2.0
- 许可证：MIT

---

## 背景：这是给谁、解决什么问题

**DSH（DeepSeek Harness）** 是一个 AI 编程/agent 框架：LLM 通过"工具调用"（函数）执行 shell 命令，再把输出喂回给模型继续推理。输出越冗长，消耗的 token 越多。

**RTK（Rust Token Killer）** 是一个命令行工具：把 `git log`、`find`、`grep`、`read` 等命令的输出压缩成紧凑形式，目标是"同样的信息，更少的 token"（实测单命令可省约 50%）。

**痛点**：RTK 只能在终端里手动敲；DSH 里的模型只能调用工具、不能敲命令行，而且模型习惯用的 `pwsh` 工具会把命令的完整原文输出直接喂给模型——token 白白烧掉。

**dsh-rtk 就是那座桥**：让 DSH 的模型在不知不觉中把命令交给 RTK 执行，享受省 token 的红利，同时不破坏原有命令语义。

> 重要定位：这是 **DSH 侧的接入层（thin adapter）**，**不 fork、不修改 RTK**。所有命令变形/过滤逻辑都属于 RTK 本体，本插件只负责"接进来"。

---

## 功能

1. **专用 `rtk` 工具**：模型可以直接调用 RTK（`rtk("git log --oneline -3")`）。
2. **RTK 感知的 `pwsh` 工具**：模型照常用 `pwsh("git status")`，插件自动改写成 `rtk git status` 执行。
3. **Windows/PowerShell 兼容映射**：`ls`/`dir` → `rtk find`、`cat`/`type` → `rtk read`。
4. **RTK 历史库重定向**：把 `RTK_DB_PATH` 指到 `$DSH_HOME/storages`（沙箱不可写时自动回退 `$env:TEMP`），让统计（`rtk gain`）在 DSH 里可用。
5. **System prompt 引导**：告诉模型优先用 RTK，从源头减少 token。
6. **Agent 作用域适配**：DSH 的 preset 会在 agent 作用域重挂原版 `pwsh`，插件在每个 agent 创建时把自己的 `pwsh` 注册进该作用域，保证 RTK 版生效，且不改动任何 preset 文件。

---

## 工作原理

```
模型调用 pwsh("git status")
        │
        ▼
1. Windows 兼容映射（ls/cat/dir/type 等简单命令）
        │
        ▼
2. 需要时调用 rtk rewrite 询问改写
        │
        ├── 能改写 → 执行 "rtk git status"（省 token）
        └── 不能改写 → 执行原始命令（绝不阻塞）
        │
        ▼
3. 结果按 DSH 工具契约返回（结构化 stdout/stderr、退出码、超时…）
```

**两条关键保证**：

- **绝不阻塞**：`rtk` 不存在、`rtk rewrite` 失败、改写后执行失败，都回退原命令。
- **绝不错改**：管道/复合命令（`ls -la | Select-Object -First 3`）和带 PowerShell 专属开关的 `cat`（`cat a.json -TotalCount 3`）**保持原生执行**，因为整行改写给 RTK 会破坏语义。

---

## 前置要求

- **Windows + PowerShell**（插件针对 Windows/PowerShell 行为设计）
- **RTK** 已安装且在 PATH 中（实测版本 0.45+）
- **DSH**（DeepSeek Harness）
- 可选：运行 `rtk init -g` 安装 hook，消除 `[rtk] No hook installed` 提示

---

## 安装

把插件作为 bundle 装进目标 profile。以 `web` profile 为例，编辑 `~/.dsh/profiles/web/package.json`。

### 方式 A：Git 依赖（其他人 / 分发场景）

仓库已公开并打了版本 tag，**任何人在任意机器上都可直接安装**，无需本地源码。

```json
{
  "name": "dsh-profile-web",
  "private": true,
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
    "@dsh-external/dsh-rtk": "github:xiao-hans/dsh-rtk#v0.2.0"
  }
}
```

然后安装并启动：

```bash
dsh plugin --profile web install
dsh web
```

> 前置：目标机器装好 **Windows + PowerShell + RTK**。插件**零运行时依赖**（只 import Node 内置模块），`dsh plugin install` 本质是转发给 profile 目录里的 pnpm，pnpm 原生支持 `github:` 依赖，克隆即可用。

### 方式 B：本地 link（仅开发者本人）

指向本机源码目录，改代码重启 dsh 即生效，无需重新安装：

```json
{
  "name": "dsh-profile-web",
  "private": true,
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

> 其余配置与方式 A 相同。

---

## 用法（模型视角）

| 模型调用 | 实际执行 | 说明 |
|---|---|---|
| `pwsh("ls")` | `rtk find . -maxdepth 1` | 自动改写，省 token |
| `pwsh("cat a.json")` | `rtk read a.json` | 自动改写 |
| `pwsh("git status")` | `rtk git status` | 自动改写（token 大头） |
| `rtk("git log --oneline -3")` | `rtk git log --oneline -3` | 专用工具，直接走 RTK |
| `pwsh("pwd")` | `pwd`（原生） | PowerShell 内建，不改写 |
| `pwsh("ls -la \| Select-Object -First 3")` | 原样（原生） | 管道保护，避免语义被破坏 |
| `pwsh("cat a.json -TotalCount 3")` | 原样（原生） | PowerShell 开关保护 |

---

## 已知限制（RTK 本体行为，插件不改写）

- `ls`/`dir` 会被 RTK 变形成 `find`，PowerShell 专属参数（如 `-ErrorAction`）会被忽略。
- `cat`/`type` 会被变形成外部 `read`，需要 RTK 的 `read` 后端，某些环境会报 `Binary 'read' not found`。
- PowerShell 内建/别名（`echo`、`pwd`、`clear`、`Get-ChildItem`）**不是可执行文件**，走 `rtk` 工具会报 `Binary 'xxx' not found`；这类命令请走 `pwsh` 工具（保持原生）。
- `rtk status` 不是有效子命令（真实命令表见 `rtk --help`，如 `config`/`init`/`gain`/`rewrite`）。
- 执行时可能出现 `[rtk] /!\ No hook installed` 提示——只是提醒未装 hook，不影响执行。

---

## 开发

```bash
npm test        # 21 个单元/集成/schema 测试（已带 --experimental-test-isolation=none，沙箱内可跑）
```

### 端到端验证（headless）

用无头 profile 在真实 DSH（真实模型）里验证 `pwsh` 自动改写：

```bash
cd /path/to/dsh-rtk   # 不要在系统 Temp 下运行（Windows ACL 沙箱要求 temp root 在 workspace 之外）
dsh --profile headless "用 pwsh 工具执行命令 ls，告诉我你传入的确切命令字符串与输出"
```

判定标准：若模型返回的 stderr 含 RTK 专属横幅 `[rtk] ... No hook installed ...`，说明执行走了 RTK（原生 pwsh 绝无此输出），改写链路正常。

---

## 版本与许可证

- **v0.2.0**：相比 v0.1.0 新增——agent 作用域遮蔽修复、服务注入重构、管道/PowerShell 开关保护、RTK_DB_PATH 沙箱回退、README 完善。
- 本仓库使用 [MIT License](./LICENSE)。
