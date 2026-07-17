# CCLink Studio — AGENTS.md

> 本文件为 Codex 提供当前项目事实源，每次会话自动加载。

## 默认协作规则

- 默认启用 `$grill-me`：每次进行架构方案、实现计划、阶段总结、质量判断或重大技术取舍时，自动执行 `/grilling` 风格审查，不需要用户手动输入 `$grill-me`。
- `/grilling` 风格要求：先给结论，再主动拷问假设、完成度、边界条件、失败路径和下一步最该做什么；不能只报喜。
- 对普通小修、小 bug、明确代码实现任务，保持简洁执行；最终总结仍要点出残余风险和验证结果。

## 产品定位

**CCLink Studio 是 CCLink 的开源桌面工作台端。**

这个仓库提供可以从源码直接运行的本地桌面壳：本地工作区、内嵌浏览器、Markdown 编辑、Agent 面板、Terminal、数据源查询和 Android 真机连接能力。

用户心智只有一个：登录 CCLink 后，在官方构建中看到桌面、手机、远程服务器、Agent 和任务状态。开源仓库默认不承载官方账号、消息网络、订阅、配额、生产 API、签名、公证或发布上传链路。

## 项目边界

| 位置 | 角色 |
| --- | --- |
| `/Users/apple/Desktop/cclink-dev/cclink-studio` | 开源桌面壳。默认不内置官方生产 API 地址，不带登录/订阅/官方消息网络/云同步/网络工作区实现。 |
| `/Users/apple/Desktop/cclink-dev` | 闭源总控/官方编译工作区。承接官方集成层、签名、公证、生产 API 注入、多仓库集成脚本和 release 基线。 |
| `/Users/apple/Desktop/chat-cc/deploy` | CCLink 云函数与账号体系。 |
| `/Users/apple/Desktop/chat-cc/Agent` | CCLink Agent runtime。 |

不存在额外拆分出的云端或 Agent 独立项目。

## 开源壳保留能力

- Electron + React + TypeScript 桌面工作台。
- VSCode 风格布局：Activity Bar、Sidebar、Workbench、Agent Panel、Status Bar。
- 内嵌浏览器和 Playwright 自动化。
- Markdown/Tiptap 编辑器和本地文件读写。
- 本地 Claude Code Agent 后端、MCP 工具系统和权限确认。
- 本地 Terminal，本地工作区和标签页恢复。
- 本地数据源只读查询，凭证只由用户本机配置和管理。
- Android 真机连接：只支持用户自有 USB 或 Wi-Fi ADB 真机。

## 不在开源壳默认路径的能力

以下能力必须通过 `cclink-dev` 与 `/Users/apple/Desktop/chat-cc` 侧官方集成进入，不能回流到本仓库默认路径：

- CCLink account / device / message / runtime 网络。
- 官方消息凭证、消息路由、配对、网络运行时注册。
- 登录、订阅、entitlement、quota、官方 feature gate。
- 云同步、网络文件树、网络文件查看、网络 session sidebar。
- 私有服务配置、生产 API 地址、官方更新源、制品上传、签名和公证流程。
- Android SDK 下载、AVD 创建、模拟器启动或托管设备服务。

## 独立启动要求

- `pnpm dev` 必须能直接启动开发模式。
- `bash scripts/restart.sh restart` 必须能启动后台开发进程。
- 默认启动不得要求存在 `cclink-dev`、`chat-cc/deploy` 或 `chat-cc/Agent`。
- 找不到 `adb` 时，应用仍应启动，Android 能力降级为不可用。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 桌面框架 | Electron 43 |
| 前端 | React 19 + TypeScript 5 |
| 构建 | electron-vite + Vite |
| 包管理 | pnpm |
| 状态管理 | Zustand |
| 浏览器自动化 | Playwright over CDP |
| Android 连接 | @yume-chan/adb + scrcpy + agent-device |
| 文档编辑 | Tiptap/ProseMirror |
| MCP 工具 | @modelcontextprotocol/sdk |
| Schema | Zod |
| 样式 | CSS variables + component CSS |

## 项目结构

```text
cclink-studio/
├── docs/                  # 当前架构、开发和功能文档
├── scripts/               # 本地开发和本地打包脚本
├── src/
│   ├── main/              # Electron 主进程与本地服务
│   ├── preload/           # contextBridge 白名单 API
│   ├── renderer/          # React 工作台 UI
│   └── shared/            # 跨进程共享 contract
├── electron-builder.yml   # 开源本地打包配置，不包含官方发布源
└── package.json
```

## 开发规范

- 语言：TypeScript，严格模式。
- 命名：文件名 kebab-case，组件 PascalCase，函数/变量 camelCase。
- Electron 安全：禁用 `nodeIntegration`，启用 `contextIsolation`。
- 文件读写：渲染进程不得直连 Node.js，统一通过主进程 IPC。
- Agent 后端：默认本机 Claude Code；官方 runtime 通过官方集成层接入。
- UI：遵循 VSCode 风格工作台精神，优先键盘、清晰状态、可审计操作。

## 常用命令

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm verify
bash scripts/restart.sh restart
bash scripts/restart.sh status
```

## 拷问重点

- 是否把官方账号、消息网络、网络 runtime、订阅、配额或发布链路重新塞回了开源默认路径？
- `preload` 是否只暴露本地安全 API 和 official no-op status probe？
- `main/runtime` 是否只初始化本地服务和显式官方集成接口？
- 删除商业模块后，开源版是否仍能免登录启动、打开本地工作区、运行本地 Agent、浏览器、编辑器、Terminal 和 Android 真机降级？
- 文档是否只描述当前事实源，不再保留研发阶段已废弃的历史路线？
