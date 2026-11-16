# Codex 启动诊断与首次失败后重选 Agent

## 用户验收

1. 在本地会话的运行环境菜单点击「检测本机 Codex」。无需先发送消息，应看到安装、启动及
   本地登录的明确结论。检测不会发送模型请求，不产生模型费用。
2. 点击状态栏「框架日志」，或 Agent 面板「复制完整诊断日志」。两者均包含「本机 Codex
   启动诊断」，记录结论、阶段、错误码、检查时间、程序路径、搜索位置、系统架构及退出码。
3. 新建会话选择 Codex ACP，在未配置 ACP API Key 时发送消息。失败后在同一会话选择
   「Codex（默认）」并重新发送；原消息保留，不需要删除会话。失败后重启 Studio 也可重选。
4. 成功建立模型 Session 后再次打开菜单，应显示不可切换的说明并禁用选项，保护原 Session。

## 结论的含义

| 结论                   | 代表错误码                                   | 判定依据                                                 |
| ---------------------- | -------------------------------------------- | -------------------------------------------------------- |
| 未找到本机 Codex       | CODEX_NOT_FOUND                              | 当前 Studio 进程 PATH 和支持的桌面安装目录均无可执行程序 |
| 未登录 ChatGPT         | CODEX_AUTH_REQUIRED                          | 原生 account/read 未返回文件登录账号                     |
| 登录方式不支持         | CODEX_AUTH_UNSUPPORTED                       | 原生账号是 API Key 等其他认证方式                        |
| 配置不兼容             | CODEX_CONFIG_UNSUPPORTED                     | 有效配置使用自定义提供商或认证端点                       |
| 启动失败               | CODEX_NOT_EXECUTABLE / CODEX_SPAWN_EACCES    | 程序不可执行或系统拒绝启动                               |
| 启动失败               | CODEX_PROCESS_EXITED / CODEX_REQUEST_TIMEOUT | 原生进程提前退出或协议握手/检查超时                      |
| 运行失败               | CODEX_MCP_HTTP_502 等                        | 实际会话的原生请求失败；保留安全的 HTTP 分类及失败阶段   |
| 会话记录缺失           | CODEX_THREAD_NOT_FOUND                      | thread/resume 明确返回找不到原生 rollout；不推定已被删除 |
| 会话已归档             | CODEX_THREAD_ARCHIVED                       | thread/resume 明确返回归档状态                          |
| 会话标识无效           | CODEX_THREAD_ID_INVALID                     | thread/resume 明确拒绝原生 thread ID                    |
| 权限边界不匹配         | CODEX_PERMISSION_BOUNDARY_MISMATCH          | 原生会话响应通过协议层，但有效权限未通过 Studio 校验     |
| 启动及本地登录检查通过 | CODEX_READY                                  | 程序握手、文件登录方式和全局提供商检查通过               |

独立探测在临时目录执行，不验证某个工作空间配置、模型联网、登录凭证是否被远端撤销或账号
额度。当前会话最近一次实际 Codex 运行的结果另外附在 Agent 完整诊断中；不能用全局探测
通过覆盖真实运行失败。原生 Codex 与旧版 Codex ACP 独立，探测也不改变当前会话选择。

## 实现约束

- 复用实际 Codex app-server 启动器、进程保护、账号与配置校验；不读取或复制 auth.json、
  系统钥匙串、邮箱或 token，不执行登录/退出，也不改全局配置。
- 主进程只通过可信 renderer 的无参数 IPC 开放探测，合并并发请求；每个协议请求最多等待
  5 秒。完成或失败均关闭进程，应用退出通过既有 runtime shutdown 入口中止未完成探测。
- 仅返回允许字段。原始 stderr、账号响应、配置正文和 RPC 错误正文不进入诊断；HTTP 状态及
  MCP 分类从错误中提取，带 Session 参数的 URL 不回传。会话恢复错误只匹配已知原因并返回固定
  文案，不回传原始 thread ID、路径或错误正文。未知错误保留 RPC 错误码并区分创建与恢复；
  请求失败与超时使用该请求自己的阶段，不能被后续并发请求覆盖。
- UI 统一使用同一切换条件：无进行中操作、无原生 Session，且为空会话或已明确失败。主进程
  再检查活动运行及可信 Session；renderer 不能靠伪造失败状态迁移已建立的 Session。
- 原生 thread 创建后，只有工具隔离检查完成才绑定到会话。检查失败不留下不可用 Session
  锁住重选。已有 Session 的失败不触发自动重绑定，历史消息也不删除。

## 验证记录（2026-11-10）

真实 Electron 窗口及本机 Codex 已验证：

- 临时空 CODEX_HOME：菜单、复制的框架日志和实际发送失败均显示未登录；原登录未修改。
- 临时 PATH 首位放置退出码 23 的测试程序：菜单及框架日志显示启动失败，并记录退出码。
- ACP 缺 Key 首发失败 → 关闭并重启 → 同一会话切换原生 Codex → 真实模型回复成功。
- 成功建立 Session 后不能切换；菜单提示与诊断文本可直接阅读，没有横向溢出。

“未找到”及没有执行权限、协议错误、超时和清理分支使用自动化覆盖；未为验收卸载本机 Codex。
181 项受影响与 runtime 测试通过，5 项可选 smoke 跳过；类型检查、构建、受影响 ESLint、
格式及凭证边界检查通过。真实窗口证据目录：
`/var/folders/4z/030bqrj52qn9vpf4w6hydk_c0000gn/T/studio-codex-diagnostics-gAqhv9`，包含
`result.json`、未登录与退出失败截图、失败会话重选截图和三份通过实际复制入口取得的框架日志。

复跑：

```bash
pnpm build
node scripts/codex-diagnostics-ui-smoke.mjs
```

脚本使用隔离的 Studio profile 和测试工作空间，最后一次恢复请求会消耗当前 Codex 账号额度。
本机源码验收不等于另一台电脑已更新；需要安装包含修复的版本后再复制日志。

## 2026-11-16 跨电脑日志排查与恢复诊断

用户提供的另一台 Mac 上 0.1.143 日志显示：首轮成功，第二轮在 thread 阶段返回
`CODEX_RPC_-32600`；全局启动及文件登录探测通过。旧版本丢弃了原生错误原因，日志不能
区分原生记录缺失、归档、无效标识与其他协议拒绝。没有证据表明模型拒答或浏览器 404
导致了这次失败，也未确认原生记录丢失。

工程验证：35 项受影响自动测试通过（3 项未启用的可选测试跳过）；主进程类型检查、受影响
ESLint 通过。使用本机 `codex-cli 0.169.0-alpha.11.1` 的 2 项真实测试通过：不存在的
thread 返回明确的记录缺失分类；真实模型首轮保存标记后，销毁 backend/进程，以新 backend
恢复相同 thread ID，正确回答前文标记。测试使用临时工作空间，不改登录、不读取钥匙串。
这证明本机基础恢复链路正常和新分类有效，不代表原问题已经修复或真实 Studio UI 已验收。

复跑真实测试（会调用模型，消耗当前账号额度）：

```bash
CCLINK_CODEX_RESUME_REAL_SMOKE=1 pnpm exec vitest run src/main/agent-core/backends/codex-resume-real.test.ts
```

原故障验收仍待完成：在出错的 Mac 安装包含此改动的版本，打开原 air-app 会话，重新发送
原消息；成功需看到回复并保持原会话连续性，失败则复制完整诊断日志中的当前会话运行结果，
按明确错误码继续处理。不要把全局 `CODEX_READY` 当作原会话恢复成功，也不要删除历史或
自动换 thread 来掩盖恢复错误。本次未发布版本、未操作另一台电脑的会话数据。

### 0.1.146 后续故障与应用内一次取证

故障 Mac 在 2026-11-16 20:03（北京时间）的重试进入了 thread 响应后的权限校验分支，
尚未发送模型请求。后续检查表明：相同 Codex 版本的新建临时会话权限正常；原会话保存的
runtime roots 只有当前工作区、路径匹配。实际不匹配项尚未取得，不能宣称原故障已修复。

新版的用户验收动作：在原 Studio 会话发送消息，失败后直接点击「复制完整诊断日志」。
无需终端脚本，当前会话记录必须一次包含：

- 实际使用的程序路径、从同一进程握手提取的 Codex 版本、是否自定义 CODEX_HOME。
- 当前请求方法、provider/permissions/session-id/tools 检查点、是否已发送模型请求。
- 原生工具是否开启及 all scope、可视浏览器约束、禁用内建工具、无需确认的读取四项判定事实。
- thread/start 或 thread/resume 的请求权限、返回权限、所有未通过原有校验的字段，以及恢复是否保留同一原生 Session。
- 审批策略/负责人、沙箱类型、网络开关、写入根目录与 runtime roots 的数量及与请求工作区匹配数、临时目录排除标记。
- 工具初始化到达时，Studio MCP 是否存在、有工具的外部服务数量、是否有下一页。

数据来自实际请求与响应，不另起探测来代替运行结果。目录只输出数量和匹配关系；未知枚举
只输出类型标签，不导出路径、Session ID、开发者指令、模型输入、MCP URL、认证或配置正文。
缺失/空值/类型不符分别显示；只读沙箱缺少写入字段不自动视为失败。权限报告与拦截使用同一
比较函数，保留原保护条件。provider、Session ID、工具隔离失败使用独立错误码。

另有已独立复现的边界缺陷：旧 runtime roots 中的额外目录会在恢复时重回可写列表。
本次恢复请求显式限定 runtimeWorkspaceRoots=[cwd]，通过 experimentalApi 协议能力启用
该字段；不放开 runtime 功能、审批或网络限制。这个修复不作为原故障已解决的证据。

工程验证入口：

```bash
pnpm exec vitest run src/main/agent/codex-runtime-diagnostics.test.ts src/main/agent-core/backends/local-codex-lifecycle.test.ts
CCLINK_CODEX_RESUME_REAL_SMOKE=1 pnpm exec vitest run src/main/agent-core/backends/codex-resume-real.test.ts
pnpm build
node scripts/codex-permission-diagnostics-ui-smoke.mjs
```

真实 Codex 测试覆盖只读和写入两种跨进程连续对话（会使用账号额度），以及隔离合成历史的
旧目录继承对照（不调用模型）。UI smoke 使用真实 Electron/UI/IPC/stdio 和确定性 Codex
fixture，首轮成功、同 Session 恢复返回 guardian/networkAccess=true 后被拦截，再从真实
复制按钮验证完整报告和独立 CODEX_READY 探测同时存在。它不代表故障 Mac 用户验收完成。

2026-11-16 发布前验证：隔离工作树构建/类型检查通过，57 项受影响与真实 Codex 测试通过；
取消状态补测 21 项生命周期测试通过。真实 Electron 复制入口验证通过，证据位于
`/var/folders/4z/030bqrj52qn9vpf4w6hydk_c0000gn/T/studio-codex-policy-ui-Ls743y`，
包含 copied-report.md 和 permission-failure.png。模拟权限拒绝没有发出第二轮模型请求，
报告保留 guardian 与 networkAccess=true 两个不匹配项及单独的 CODEX_READY 探测。
