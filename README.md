# @dsh-external/dsh-rtk

DSH 的 RTK 薄适配插件：不 fork RTK，只做 DSH 侧的接入层。

## 功能

- 自动改写 `pwsh` 命令：常见命令自动变成 `rtk ...`。
- 提供专用 `rtk` 工具，模型可以直接调用。
- Windows/PowerShell 兼容映射：`ls` / `dir` / `cat` / `type` 等自动映射到 RTK 可用命令。
- 将 RTK 统计数据库重定向到 `$DSH_HOME/storages/rtk-history.db`，避免 sandbox 拒绝访问。
- 注入 DSH system prompt，指导模型优先使用 RTK。

## 当前状态

- 独立插件包，尚未安装进 DSH profile。
- 前台执行已支持；后台任务（`run_in_background`）暂未实现，后续可补。
- sandbox 升级字段（`sandbox_permissions` / `justification`）暂未实现；命令在 DSH 当前 sandbox 模式下执行。

## 安装（后续）

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

## 测试

```bash
npm test
```
