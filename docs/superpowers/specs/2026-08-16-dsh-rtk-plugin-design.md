# DSH RTK 薄适配插件设计

日期：2026-08-16  
状态：已确认

## 目标

在 DSH（DeepSeek Harness）中实现一个不 fork RTK 的薄适配插件，让常见 `pwsh` 命令自动走 RTK，并提供专用 `rtk` 工具，同时解决 Windows/PowerShell 下的兼容问题。

## 非目标

- 不 fork / 不修改 RTK 源码。
- 不实现 RTK 自身的过滤逻辑。
- 当前不安装进 DSH profile，只做独立插件包。

## 包结构

```text
D:\HANXIAO\Documents\dsh-rtk\
├── package.json
├── cordis.patch.yml
├── README.md
├── lib\
│   ├── index.js          # Cordis 插件入口
│   ├── rewrite.js        # 命令改写 + Windows 兼容映射（纯函数）
│   ├── pwsh-tool.js      # 自动改写版 pwsh 工具
│   └── rtk-tool.js       # 专用 rtk 工具
└── tests\
    └── rewrite.test.mjs  # 纯函数单测
```

## 插件入口

`lib/index.js` 导出标准 Cordis 插件：

```js
export const name = 'dsh-rtk'
export const inject = ['tools', 'shell', 'systemPrompt', 'shellEnv']
export function apply(ctx, config) { ... }
```

`apply` 中完成：

1. 注册系统提示词段落，指导模型优先使用 RTK；
2. 注册专用 `rtk` 工具；
3. 注册自动改写版 `pwsh` 工具。

## cordis.patch.yml

安装时通过 patch 禁用 DSH 自带 `tool-pwsh`，插入本插件：

```yaml
- id: tool-pwsh
  disabled: true

- insert:
    - id: dsh-rtk
      name: '@dsh-external/dsh-rtk'
      config: {}
```

## 自动改写流程

```
模型调用 pwsh("git status")
        ↓
我们的 pwsh 工具
        ↓
1. Windows 兼容映射（ls/cat/dir/type 等）
        ↓
2. 调用 rtk rewrite "git status"
        ↓
3. 能改写 → 执行 "rtk git status"
   不能改写 → 执行原始 "git status"
        ↓
4. 结果按 DSH pwsh 同样的格式返回
```

`rtk rewrite` 是 RTK 官方重写入口；所有过滤逻辑仍由 RTK 二进制完成。

## Windows 兼容映射

| 用户命令 | 处理方式 |
|---|---|
| `ls` / `ls <path>` | 改写为 `rtk find <path> -maxdepth 1` |
| `dir` / `dir <path>` | 同上 |
| `cat <file>` | 改写为 `rtk read <file>` |
| `type <file>` | 改写为 `rtk read <file>` |
| `find ...` | 直接走 `rtk find` |
| `grep ...` | 直接走 `rtk grep` |
| 其他 | 完全信任 `rtk rewrite` |

映射不确定时回退原始命令，保证不阻塞。

## 专用 rtk 工具

注册 `rtk` 工具，模型可直接调用：

```json
{
  "command": "git status"
}
```

内部执行 `rtk git status`，同样应用 Windows 兼容映射和 `RTK_DB_PATH` 重定向。

## Tracking 权限处理

执行 RTK 命令前，在 PowerShell 命令前缀中注入环境变量：

```powershell
$env:RTK_DB_PATH='<DSH_HOME>\storages\rtk-history.db'; rtk git status
```

其中 `<DSH_HOME>` 在插件运行时通过 `process.env.DSH_HOME` 计算，缺省回退到用户目录下的 `.dsh`。  
这样将 RTK 统计数据库重定向到 DSH 可写目录，避免 sandbox 拒绝访问。

## 错误处理

- `rtk` 不存在 → 直接执行原始命令；
- `rtk rewrite` 失败 → 直接执行原始命令；
- 改写后执行失败 → 保留 RTK 的退出码/错误输出；
- 所有失败路径都不阻塞原命令。

## 测试

- `tests/rewrite.test.mjs`：单测 Windows 映射和 `rtk rewrite` 调用逻辑；
- 手动验证：在 DSH 里调用 `pwsh("git status")` 应自动变成 `rtk git status`；
- 当前不安装，先保证插件包可独立测试。

## 暂不做

- 不 fork RTK；
- 不安装进当前 DSH profile；
- 后台任务/PTY 先保持和原 `pwsh` 工具一致；若实现复杂度太高，先做前台版本并在 README 标注。
