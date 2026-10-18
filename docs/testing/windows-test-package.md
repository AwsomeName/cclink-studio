# Windows x64 测试安装包

用户验收动作：在 Windows x64 上运行测试 EXE → 选择安装目录 → 免登录启动 Studio →
打开本地文件夹并读写 Markdown → 新建浏览器页访问网站 → 新建 Terminal 执行 `echo hello` →
退出并重新启动。只有真人完成这些动作并记录结果，才可称 Windows 用户验收通过。

本轮范围为未签名测试安装包，不进入 macOS 稳定 Release，也不修改版本号或 Tag。
应用、Workspace、Browser、Terminal、Runtime 和更新状态继续由既有 owner 管理，
不增加 IPC、权限或另一套更新实现。Mac 原生更新助手只进入 Mac 包。

## 构建

在原生 Windows x64 上使用 Node.js 22 和 pnpm 11.5.0：

```powershell
pnpm install --frozen-lockfile
pnpm package:windows
pnpm smoke:windows-packaged
```

产物为 `dist/windows/cclink-studio-X.Y.Z-windows-x64-test-setup.exe`，同时生成 SHA-256 和
源码指纹记录。打包入口校验 ASAR 元数据、源码一致性和目标 Electron 中的 node-pty 加载；
不接受从 Mac 直接交叉打包后跳过原生验证。构建失败时不会上传成功安装包。

`windows-package.yml` 在 Windows 2022 runner 上执行以上流程。CI 使用临时目录实际静默
安装，再从已安装 EXE 启动，检查免登录工作台、隔离 userData、文件读写、真实 PTY 命令与
内嵌浏览器页面，最后卸载。普通本地 smoke 只启动 `win-unpacked`，不改本机安装注册项。
成功 Actions artifact 保留 14 天，包含测试 EXE、校验记录、自动 smoke JSON 和截图；
失败只上传诊断。自动 smoke 属于工程验证，不代替真人安装验收。

## 支持边界与失败降级

- 未配置 Windows Authenticode 签名；测试包可能显示未知发布者，正式签名分发尚未交付。
- 托管 Claude Runtime 目录目前仅支持 macOS arm64，Windows 不能在组件管理中安装它。
  不可用状态沿用 Runtime 管理器，不伪装成 Agent 可用；本地工作台应继续可用。
- 应用内自动更新当前只支持 macOS arm64。Windows 使用已有 NoopUpdateProvider，
  后续测试包手动安装；不得下载 Mac DMG 或引入另一套 updater。
- Windows ARM64、32 位、远程在线 Agent、真实 Android 设备及完整模型会话不在本轮验收内。

## 验证记录

构建、安装和自动 smoke 结果以对应 Actions run 与 artifact 中 `smoke/results.json` 为准。
Windows 真人验收：待执行。不能根据构建成功宣称全部 Windows 能力可用。
