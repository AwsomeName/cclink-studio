# npm 可更新能力清单

> 状态：固定版本 Runtime 安装、检查、修复、卸载和 App 替换复用已交付；远程版本目录、真实双版本更新/回滚、内容包和通用能力插件自 2026-08-15 起暂停。
> 最后更新：2026-08-15。详细产品边界见 `runtime-components-and-capability-plugins.md`。

## 当前结论

npm 目前只作为已审核固定 Runtime 的下载源，不建设通用 npm 更新或插件平台。这里的 npm 不是在用户电脑上执行 `npm install` 或 `npm update`，而是 Studio 下载随 App 发布的允许记录中的精确 tarball，自行校验、解包和管理。

当前产品决定：

- 保留 Claude `2.1.211`、OCCT `0.0.23`、scrcpy `2.3.1` 和 agent-device Helper `0.17.2` 的固定版本管理。
- 不建设远程签名版本目录，不把 npm `latest` 变成用户端更新源。
- 不建设 Plugin Host、通用插件市场或内容包 npm 发布链。
- 小型配置、模型名称、提示词和文案体积小，不因体积或发版成本单独 npm 化。
- 只有当至少两个真实 Runtime 版本在现有 Host/SDK 上通过兼容性验收，且独立发布能解决已发生的产品问题时，才重启双版本更新评审。

## 能力清单

| 能力 | 当前交付 | 与 App 的兼容关系 | 当前决定 |
| --- | --- | --- | --- |
| Claude Code Runtime | 固定 `2.1.211` 可安装、检查、修复、卸载和实际运行 | App 内 Agent SDK 与 CLI 需要配套验证 | 保留现状；真实双版本更新暂停 |
| OCCT Runtime | 固定 `0.0.23` WASM 可管理并被 CAD 使用 | JavaScript 适配器仍随 App，JS/WASM 必须兼容 | 保留现状；不建设独立更新 |
| scrcpy server | 固定 `2.3.1` 可管理并被 Android 使用 | Server 必须匹配 App 内 Client 和协议版本 | 保留现状；不单独追新 Server |
| agent-device Helper | 固定 `0.17.2` 可下载校验 | 上游 Host 暂无受管资源注入 contract | 保留“已下载，待宿主支持”；不扩展 |
| MCP 工具 | 随 App 构建和发布 | 需无 Node 的隔离 Plugin Host 和权限 broker | 通用插件化暂停 |
| 模型/图片 Provider | 随 App 构建和发布 | 需凭证和网络 broker，不能直进主进程 | 插件化暂停 |
| 数据源 Adapter | 随 App 构建和发布 | 需凭证、网络和数据源 broker | 插件化暂停 |
| 配置、模板、提示词、帮助文案 | 随 App 发布 | 是小型数据，不影响主要安装包体积 | 不做 npm 内容包；若未来必须远程更新，优先评估更简单的受控 JSON |

## 不能按普通 npm 插件更新的部分

| 能力 | 结论 | 原因 |
| --- | --- | --- |
| Electron `main`、`preload`、IPC contract | 必须完整 App 更新 | 属于核心权限和进程边界 |
| 主 React UI、路由和工作台布局 | 必须完整 App 更新 | 不允许远程代码注入 renderer |
| 权限判断、凭证存储、工作空间边界 | 必须完整 App 更新 | 下载包不能修改宿主安全规则 |
| Agent loop、Thread 和 Session 状态所有权 | 必须完整 App 更新 | 不能产生第二套 Agent Runtime 或第二状态源 |
| Runtime Manager、签名校验器、更新器 | 必须完整 App 更新 | 更新系统不能安全地更新自己 |
| Electron、React、Playwright、`node-pty` 等核心依赖 | 必须完整 App 更新 | 会改变打包、原生 ABI 或核心运行环境 |
| 任意第三方 npm 包、安装脚本、原生 Node 模块 | 默认禁止 | npm 来源本身不构成权限与信任边界 |

## 当前固定版本安装流程

```text
瘦安装包不携带 Claude 可执行文件
  -> 用户离线仍能打开 Studio，对应能力明确降级
  -> Studio 读取随 App 发布的精确固定允许记录
  -> 用户点击安装
  -> 下载并校验 integrity、SHA-256、平台、架构和文件内容
  -> 解包到 userData 的固定版本目录
  -> probe 或业务校验通过后使用
  -> 失败保留已安装的健康版本；没有可用版本时仅对应能力降级
```

Runtime 仍是 Runtime 组件，不是普通插件。Studio 不要求用户安装 Node.js、npm 或 pnpm，不执行包内 lifecycle script，不接受用户输入任意包名、URL 或 `latest`。

## 当前完成度

当前 Studio 已能在应用内安装、检查、修复和卸载固定 Claude、OCCT、scrcpy 和 agent-device Helper 制品，校验后存入 `userData` 并在 App 覆盖升级后复用。OCCT 与 scrcpy 已由各自领域服务实际使用，损坏时退回随 App 资源；agent-device Helper 只能如实显示“已下载，待宿主支持”。

Claude Code 可执行文件不再进入 `.app`；完整 App 更新只传输 Electron、Agent SDK 和宿主代码。

未交付且已暂停：任意插件安装、隔离 Plugin Host、内容包、远程签名目录，以及两个真实版本之间的更新/回滚。产品对外只宣称“固定版本独立安装、修复和 App 替换复用”，不把“通用 npm 更新系统”列为当前路线图。
