# HTTP Basic 认证：记住账号密码

## 用户验收动作

1. 在 Studio Browser Tab 打开受控 Basic 认证站点，输入凭证，勾选“记住账号密码”。
2. 公网 HTTP 额外确认允许此地址以后自动发送凭证；未确认时不能自动保存发送授权。
3. 进入受保护页面后退出 Studio，重新启动并恢复同一 Tab，或从已保存的网站账号打开。
   应直接进入受保护页面，无需重新输入。
4. 服务端更换密码后重新访问：旧凭证最多自动尝试一次，随后显示输入窗口；输入新密码并
   勾选记住可替换。取消不能形成重试循环。
5. 设置 → 本地凭证中清除该站点凭证，退出重启后重新要求输入。未勾选保存也不跨重启记忆。

## 实现边界

- CredentialService 是唯一持久凭证 owner；复用 userData/credentials/credentials.json，
  目录 0700、文件 0600，明文存储，不使用系统钥匙串。
- BrowserManager 唯一拥有 Profile 和挑战身份；凭证 ID 由 Profile、完整 origin 和原始 realm
  共同派生。不同协议、端口、Profile 或 realm 不共享凭证，显示用的 realm 截断不能影响身份。
- BrowserAuthProcessService 只拥有当前挑战和尝试记录。密码不进入子进程参数、工作空间、
  浏览器账号快照或诊断；恢复时只在主进程提交给 Electron callback。
- 凭证存储不可用时仍可单次登录。保存失败必须留在认证窗口明确提示，允许取消勾选后单次登录。
- 勾选表示保存本次输入并用于后续认证，不代表服务端已验证成功。被拒绝后允许替换，
  不自动删除用户已保存的凭证。每个 Tab 运行代次/认证域只自动尝试一次。
- 普通 Tab 的草稿 Profile 沿用现有生命周期。关闭并删除未保存草稿后，新建 Tab 是新 Profile；
  若要关闭 Tab 后从账号入口复用，需要使用“保存账号和登录状态”。
- 取消、导航、Tab 销毁及应用关闭均使旧挑战失效；服务端验证结果仍来自真实导航事件。

## 验证记录

2026-11-11：受影响单测 72 项通过；`pnpm smoke:browser-http-auth-remember` 在七个独立
Electron 进程中使用生产 BrowserManager、认证子进程和 CredentialService，验证：保存、
重启恢复、错误旧密码后替换、重启恢复新密码、不同 Profile 隔离、不保存后重启仍弹窗、
清除后重新弹窗。包含公网 HTTP 分类的确认 UI 和带首尾空格的密码，凭证文件权限为 0600。
原有 `pnpm smoke:browser-http-auth`、`pnpm build`（含前后端类型检查）、
`pnpm verify:credential-boundary` 以及变更源码 ESLint/Prettier 检查通过。
认证窗口已截图检查，并验证错误密码重试时登录按钮仍在可见区域。

用户提供的 Argus 站点尚未在新构建中完成真人验收；不得将受控 smoke 结果写成该网站已验收。
