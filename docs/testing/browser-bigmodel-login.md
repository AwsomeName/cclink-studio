# 智谱 BigModel 登录的第二层身份验证失败

状态：2026-10-15 开发版已通过真实账号登录、原 Tab 回传、关闭重开和完整重启验收。
2026-10-16 已将遗漏在功能分支的修复接回当前 `main` 代码，尚未发布包含修复的新安装版；
另一台 Mac 的安装版登录闭环仍待验收。

## 2026-10-16 安装版缺少修复

用户提供的另一台 Mac 框架诊断日志显示应用版本为 `0.1.118`，当前可见页面仍为主工作台
`https://bigmodel.cn/login`，截图显示页面内身份验证滑块。

检查源码历史确认，上次修复提交 `72fcef16` 只在本地 `codex/zhipu-login` 分支，未进入
`main`，也不是 `v0.1.118` 解引用提交 `af7eb9a9` 的祖先。当前主线原先只支持 V2EX 独立
认证，因此这次首先是已验收修复没有进入发布源码的问题，不能据此判定为新设备风控或修复回归。

本轮复用原修复的认证 contract、子进程、导航路由与关闭清理，保留当前主线其他功能。
网站人机验证仍由用户手动完成；修复目标是让验证与登录能完成并回传原账号 Tab，
不是保证网站不显示人机验证。新安装版必须另外验证打开账号、手动登录、自动返回、
关闭重开及完整重启；当前机器的自动检查不能替代另一台 Mac 的验收。

本轮工程验证：四个受影响测试文件共 66 项通过；受影响文件 ESLint、完整 TypeScript
检查与 `pnpm build` 通过。`CCLINK_AUTH_SMOKE_PROFILE_ONLY=1 node
scripts/auth-window-smoke.cjs` 的真实 Electron Cookie/localStorage 跨进程重启持久化通过。
这些结果只证明主线接入与工程门禁，未在另一台 Mac 上重新登录，也未发布新版本。

## 用户验收目标与结果

用户从 Studio 的“网站与账号”打开智谱账号，在独立认证窗口手动完成人机验证和短信登录，
返回同一个账号 Tab；关闭重开该账号及重启 Studio 后仍然已登录。

2026-10-15 23:39（Asia/Shanghai）用户确认已登录并自动返回 Studio；随后真实界面核验为智谱用量页。
23:40 关闭 Tab 并从账号库重开通过；23:42 完全退出并重启 Studio 后再次打开账号通过，均未再次登录。
认证子进程已退出；只查询 Cookie 元数据确认主 Profile 有 1 条登录 Cookie，认证 Profile 为 0 条，未读取或记录值。

## 真实失败证据

2026-10-15 的真实 Studio v0.1.114 中：

1. 腾讯 `cap_union_new_verify` 返回 HTTP 200、`errorCode: 0`。
2. 随后的 `/api/biz/code/smsCode/TencentVerifyCaptcha` 触发第二层阿里云身份验证。
3. 阿里云初始化、脚本和校验请求均返回 HTTP 200。
4. 用户刷新后，校验响应仍为 `Success: true`、`Result.VerifyCode: F001`、
   `Result.VerifyResult: false`。`Success` 只代表 API 请求成功。

阿里云将 F001 定义为风险策略不通过。该证据定位到第二层业务拒绝，尚不能单凭此码证明
具体是哪一种浏览器特征、网络出口或网站策略触发。

参考：https://help.aliyun.com/zh/captcha/captcha2-0/user-guide/description-of-data-returned-by-the-client

## 修复边界

- 扩展现有 `BrowserAuthProcessService` / `browser-auth-child`，只识别精确 HTTPS
  `bigmodel.cn/login`；兼容首次加载、恢复和 SPA 跳转。后台 Tab 激活前不弹认证窗口。
- 认证子进程没有 preload、CDP 或自动化挂钩，启用 sandbox 和 context isolation。
  人机验证、扫码、协议确认和短信码均由用户处理。
- 原 Tab、Profile 和网站账号归属保持不变。Cookie 仅通过受校验的主进程/子进程 IPC 回传，
  不进入 renderer、Agent、诊断或工作空间文件。
- 仅接受精确 BigModel 域名、根路径下的安全登录 Cookie `bigmodel_token_production`；
  不复制验证票据或其他站点 Cookie。检测到登录 Cookie 且网站已离开登录页，才允许回传。
- 每次认证绑定请求 ID、Tab、Profile、provider 和 runtime generation。Tab 关闭/重建、
  认证取消或进程退出会释放本次请求；旧结果不能写入新的账号环境。
- 主 Profile 确认接收后清除认证子进程中的 BigModel 登录 Cookie，避免主 Profile 退出后
  被第二份登录状态恢复。认证窗口关闭不影响其他本地能力。
- 未调整网站策略、验证码结果、证书验证或 Chromium 安全隔离；F001 在独立认证窗口仍出现时，
  下一步对照同网络的 Chrome 和不同网络结果，不继续增加伪装补丁。

## 自动验证

- 认证 contract 与 BrowserManager：59 项相关单测通过，包括 SPA/完整导航、后台激活、
  取消后不重复弹窗、原 Profile 回写、过期 Cookie 及关闭/重建后的旧回传拒绝。
- 认证进程生命周期：4 项单测通过，包括启动参数、消息边界、Tab 关闭、迟到结果和取消重试。
- 认证子进程：3 项单测通过，包括仍在登录页时不回传、过期 Token 拒绝、重复事件只回传一次、匹配 ACK 后才清除认证副本。
- Node TypeScript 检查、受影响文件 lint、构建通过。
- `CCLINK_AUTH_SMOKE_PROFILE_ONLY=1 node scripts/auth-window-smoke.cjs`：真实 Electron
  Cookie 和 localStorage 跨进程重启持久化通过；不代表第三方登录成功。

## 真人验收步骤与结果

| 操作                       | 完成条件                                          | 结果                         |
| -------------------------- | ------------------------------------------------- | ---------------------------- |
| 打开已保存智谱账号         | 独立认证窗口出现，原账号 Tab 保留                 | 10-15 开发版通过；新安装版待验收 |
| 手动验证与短信登录         | 通过第二层验证并进入已登录页面                    | 10-15 开发版通过；新安装版待验收 |
| 返回 Studio                | 同一 Profile 的原 Tab 显示已登录页面              | 10-15 开发版通过；新安装版待验收 |
| 关闭并重新打开账号         | 无需再次登录                                      | 10-15 开发版通过；新安装版待验收 |
| 完全重启 Studio 后打开账号 | 无需再次登录                                      | 10-15 开发版通过；新安装版待验收 |
| 取消或关闭认证窗口         | 原 Tab 和其他工作台能力可继续使用，可重新发起登录 | 自动测试通过；未另做真人取消 |
| 在主 Profile 退出登录      | 不从认证子进程的第二份 Cookie 自动恢复登录        | 待验收                       |
