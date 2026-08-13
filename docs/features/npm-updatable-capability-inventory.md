# npm 可更新能力清单

> 状态：固定版本 Runtime 首批已实现，Claude 已改为按需安装；通用能力插件和内容包尚未实现。最后更新：2026-08-13。
> 详细产品边界见 `runtime-components-and-capability-plugins.md`。

## 一句话结论

npm 可以作为内容包、能力插件和 Runtime 组件的下载源，但三者不能用同一种方式运行：

- 内容包由宿主读取数据；
- 能力插件在隔离的 Plugin Host 中运行；
- Runtime 是本地可执行资源，由 Runtime Manager 校验、启动和回滚。

这里的“通过 npm 更新”是指 Studio 下载指定版本的 npm tarball 并自行校验、解包和管理，
不是在用户电脑上执行 `npm install`、`npm update` 或包内 lifecycle script。

## 可以通过 npm 下载、更新和管理的能力

| 能力                      | 分类         | npm 下载/更新 | 生效方式                                   | 管理方式                                                              | 首期结论                             |
| ------------------------- | ------------ | ------------- | ------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------ |
| Claude Code Runtime       | Runtime 组件 | 可以          | 无活动任务时切换；运行中任务继续固定旧版本 | `RuntimeComponentManager` 下载校验，`ClaudeRuntimeManager` 选择和运行 | 固定 `2.1.211` 已实现                |
| CAD / OCCT / FreeCAD 后端 | Runtime 组件 | 可以          | 完成 probe 后，新转换任务使用新版          | Runtime Manager + CAD 领域服务                                        | OCCT WASM `0.0.23` 已实现            |
| `scrcpy-server.jar`       | Runtime 组件 | 可以          | Android 会话重连后生效                     | Runtime Manager + Android 领域服务                                    | 固定 `2.3.1` 已实现                  |
| 受控 WASM / 辅助程序      | Runtime 组件 | 可以          | probe 通过后在安全点切换                   | Runtime Manager                                                       | agent-device APK 已下载，尚未激活    |
| MCP 工具                  | 能力插件     | 可以          | 重启对应 Plugin Host 后生效                | `PluginManager` + 隔离 Plugin Host                                    | 首批推荐样本                         |
| 模型或图片服务 Provider   | 能力插件     | 可以          | 重启对应 Plugin Host；新请求使用新版       | `PluginManager`，凭证仍归 `CredentialService`                         | 可做                                 |
| 数据源 Adapter            | 能力插件     | 可以          | 重启对应 Plugin Host；新查询使用新版       | `PluginManager`，数据源状态仍归原领域服务                             | 可做                                 |
| 平台 Adapter              | 能力插件     | 可以          | 重启对应 Plugin Host 后生效                | `PluginManager` + Host 有界 API                                       | 可做，但不能新增系统权限             |
| 声明式命令 contribution   | 能力插件     | 可以          | 重载插件贡献后生效                         | `PluginManager`，命令仍走统一上下文操作系统                           | 可做；不能注入任意 React UI          |
| 模板、提示词、帮助文案    | 内容包       | 可以          | 重新加载后生效；运行中任务默认固定旧版本   | 受验证的内容包管理器                                                  | 可做；不得夹带可执行代码             |
| 模型目录、兼容规则        | 内容包       | 可以          | 新任务或用户确认后生效                     | 受验证的内容包管理器                                                  | 可做；影响行为的变更必须可见、可回滚 |
| 静态资产                  | 内容包       | 可以          | 重新加载后生效                             | 受验证的内容包管理器                                                  | 可做；拒绝可执行 HTML、SVG 和脚本    |

## 不能按普通 npm 插件更新的部分

| 能力                                                | 结论              | 原因                                      |
| --------------------------------------------------- | ----------------- | ----------------------------------------- |
| Electron `main`、`preload`、IPC contract            | 必须完整 App 更新 | 属于核心权限和进程边界                    |
| 主 React UI、路由和工作台布局                       | 必须完整 App 更新 | 第一版不允许远程代码注入 renderer         |
| 权限判断、凭证存储、工作空间边界                    | 必须完整 App 更新 | 插件不能修改宿主安全规则                  |
| Agent loop、Thread 和 Session 状态所有权            | 必须完整 App 更新 | 不能产生第二套 Agent Runtime 或第二状态源 |
| Plugin Manager、Runtime Manager、签名校验器、更新器 | 必须完整 App 更新 | 更新系统不能安全地更新自己                |
| Electron、React、Playwright、`node-pty` 等核心依赖  | 必须完整 App 更新 | 会改变打包、原生 ABI 或核心运行环境       |
| 任意第三方 npm 包、安装脚本、原生 Node 模块         | 默认禁止          | 无法仅凭 npm 来源获得可信权限边界         |

带二进制、Node 原生模块或系统可执行文件的包，不代表永远不能更新；它只能从“普通插件”
升级为“经过单独审查的 Runtime 组件”，再走平台分包、签名、probe、安全点切换和回滚流程。

## 首次安装和后续更新

推荐流程：

```text
瘦安装包不携带 Claude 可执行文件
  -> 用户离线仍能打开 Studio，Agent 明确降级
  -> 首次启动并进入工作台
  -> Studio 检查维护者允许目录中的精确 npm 版本
  -> 用户确认来源、大小和权限
  -> 下载 tarball，校验 integrity、SHA-256、发布者、平台和架构
  -> 解包到 userData 的不可变版本目录
  -> probe 成功后，在安全点启用
  -> 失败保留上一可用 managed 版本；没有旧版本时仅 Agent 不可用
```

Runtime 可以在首次启动后通过 npm 安装，但它仍是 Runtime 组件，不是普通插件。DMG 不携带
Claude 可执行文件，首次启动页也不阻断工作台；本机已有 Claude 时仍可直接选择系统版本。

## 共同限制

- 只允许维护者目录中列出的包和精确版本，不接受用户输入任意包名或 `latest`。
- Studio 直接下载 tarball，不要求用户安装 Node.js、npm 或 pnpm。
- 不运行 `preinstall`、`install`、`postinstall` 和动态下载器。
- npm integrity 不是唯一信任依据，还必须验证 Studio 记录的哈希和维护者签名。
- 更新不能静默扩大网络、文件、凭证或外部操作权限。
- 当前任务固定旧版本；新版只影响新任务或在明确的安全点生效。
- 新版失败必须隔离并回滚，核心工作台仍能启动。
- OSS 与商业版使用独立目录、凭证、签名密钥和发布状态。

## 当前完成度

当前 Studio 已能在应用内安装、检查、修复和卸载固定 Claude、OCCT、scrcpy 和 agent-device
Helper 制品，校验后存入 `userData` 并在 App 覆盖升级后复用。OCCT 与 scrcpy 已由各自领域服务真实使用，损坏时
退回随 App 资源；agent-device Helper 因上游 host 没有资源注入 contract，只能显示“已下载，
待宿主支持”，不能宣称已激活。

Claude Code 可执行文件不再进入 `.app`；完整 App 更新只传输 Electron、Agent SDK 和宿主代码。

尚未交付：任意插件安装、隔离 Plugin Host、内容包、远程签名目录，以及两个真实版本
之间的更新/回滚。因此“固定版本独立安装和修复”已完成，“通用 npm 更新系统”尚未完成。
