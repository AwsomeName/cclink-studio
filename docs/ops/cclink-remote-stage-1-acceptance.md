# CCLink 远程第一阶段验收记录

> 日期：2026-08-13，最近补充：2026-08-29。状态：用户已在 0.1.29 真实 App 中登录并打开远程
> 项目；v0.1.65-v0.1.71 又完成审批、分页读取、图片输入、停止等待和 realtime 启动的工程修复，
> 这些新增能力仍待同一真实在线 Agent 回归。

## 用户验收目标

> 用户启动 Studio，不登录也能打开本地项目；点击 CCLink 远程入口后登录，选择在线设备和远程目录，打开并读取一个文件。

## 已实测

- 默认服务配置下启动真实 Electron App，首屏为本地工作台，没有全局登录页。
- 点击“CCLink 远程”后才出现手机号登录界面，本地顶栏和工作台仍存在。
- 以 `CCLINK_API_URL=off` 启动真实 App，远程入口显示“远程服务未配置”，本地工作台继续可用。
- 缺配置模式下，真实 App 已打开临时本地项目，完成 Markdown 读取/保存/重命名、Browser Tab 和 Terminal cwd 执行。
- 用户提供的 0.1.29 真实 App 截图与诊断日志证明：已登录、选择在线设备 `supermicro` 及远程项目 `gl-bp`，工作区键为 `cclink://agent_4a639cb888a15d75/5c76b916a5b6c0de322e3239`。该记录同时暴露了工作区 Tab 没有切换和远程消息误走本地 `agent:sendMessage` 的问题。
- 本次修复后重启真实开发 App，再次确认未登录时本地项目、本地 Agent 和浏览器可用；点击远程入口后登录只出现在远程侧栏。
- 以 `CCLINK_API_URL=off` 重启真实开发 App，确认显示“远程服务未配置”，本地项目、本地 Agent 和浏览器继续可用。

## 已接入但尚未实机闭环

当前开发 App 没有可用的 Session；根据 `NO_SYSTEM_KEYCHAIN`，不能读取旧钥匙串或旧密文，必须由用户重新完成短信登录。因此以下新增链路只能标记为“工程实现完成，产品验收待执行”：

1. 在远程文件树新建测试文件，修改保存，重命名后删除；
2. 新建远程 Agent 会话，发送消息并收到流式回复/工具事件；
3. 打开远程 Terminal，执行 `pwd`，断网恢复后确认 PTY attach 和输出续接。
4. 连续触发多次远程 `WebSearch`，确认 Studio 自动批准、不显示逐条确认卡，
   且远程任务继续执行。

## 独立审查后的桌面端补齐记录

- Session 磁盘文件只保留 refresh token；旧 `cclink-user.json` 启动时删除且不读取、不迁移，
  用户资料、access token、IM UserSig 和完整远程身份只驻留当前进程内存。
- 工具审批和 Agent 提问不再以“消息已发送”冒充成功：Studio 等待并校验
  `tool_approval_ack` / `question_answer_ack` 后才更新状态；错误保持可重试。AskUserQuestion
  使用问题文本作为 answers key，并支持以逗号分隔协议提交多选答案。精确名为
  `WebSearch` 的只读远程工具由 Studio 自动批准；ACK 失败时恢复人工确认卡，
  其他工具的审批边界不变。
- 首次目录浏览触发的 `permission_request` 现在直接显示在远程目录选择器中，无需先打开
  Workspace。远程脏文件重新读取前要求确认；退出 flush 会等待尚在 debounce 窗口内的草稿
  写盘，草稿目录移动/删除按完整 WorkspaceRef 隔离，单次写失败不会毒化后续保存队列。

- 远程文件编辑已接入 `Cmd/Ctrl+S`、未保存关闭确认、部分读取禁止覆盖，以及文件/目录重命名和删除后的 Tab、脏草稿联动。
- 远程草稿不再只驻留 renderer：现在写入 `userData/remote-workspaces/file-drafts.json`，权限
  为 `0600`；App 重启或 renderer 重建后按 WorkspaceRef + 路径恢复，目录重命名和删除同步
  rebase/清理。删除已打开且有脏修改的路径必须再次确认，文件删除前读取并携带当前 SHA。
- 远程会话已接收入站 `user_text`、`agent_status`、错误状态、搜索、归档和本地恢复。会话与消息使用权限为 `0600` 的独立状态文件；access token、refresh token、IM UserSig 和完整远程身份不进入该文件。
- 远程 Agent 已接通 `agent_tool.requires_approval`、`tool_approval_response`、`user_question`、
  `question_answer` 与普通文件 `permission_request/permission_response`；工具输入/输出/错误在
  落盘前递归脱敏。远端 session sync 缺项不再删除本地导入历史，实时 sessions 事件会更新 UI，
  切换工作区的过期异步结果会被 generation 丢弃。
- 首次启动且当前状态文件不存在时，只读导入旧商业桌面目录 `cclink-state.json` 中会话和消息的白名单字段；不读取或迁移旧 Session、身份文件、密文或系统钥匙串，源文件不修改。
- 腾讯 IM SDK 的真实掉线/恢复事件已进入统一实时生命周期。远程 PTY 对同一 Studio session
  幂等启动，App 恢复时 attach 原 PTY，输出断档有明确提示，keepalive/attach 失败采用有界
  指数退避且不删除映射；关闭运行中的远程 Terminal 时由用户选择终止、保留或取消。
- `RemoteProvider` 现在实时请求 `capability_probe`，探测失败按不可用处理，实际读写、Agent 和
  PTY 操作再次检查能力与协议；WorkspaceRef 必须同时匹配已发现/已打开的设备工作区，路径
  schema 只接受 POSIX、Windows 盘符或 UNC 绝对路径。
- 远程 Workspace 不再创建伪本地 Agent conversation；项目条增加远程项目移除入口；Terminal
  preload 去掉 `any` 参数并在主进程使用严格有界 schema。
- 正式 Release 的 Developer ID 签名、Apple 公证、staple 与 Gatekeeper 门禁已恢复；
  `NO_SYSTEM_KEYCHAIN` 继续只约束应用运行时，发布凭证只存在于隔离的 GitHub runner。
- 以上是桌面代码和自动化门禁完成，不替代在线设备真人验收。

## 2026-08-28 至 2026-08-29 远程事故补充

下列问题已经进入正式版本，但此前没有在本验收事实源中逐项记录。这里补齐代码状态、用户边界和
仍缺的证据；版本发布与自动化通过不替代真实在线 Agent 验收。

| 事故与版本                       | 已修复的代码行为                                                                                         | 尚未关闭的用户证据                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| v0.1.65 工具审批卡消失           | `executing` 不再覆盖尚未处理的审批；明确批准、拒绝或权威终态才清除审批                                   | 真实远程工具连续进入审批、批准和拒绝各一次，确认只有一张稳定审批卡 |
| v0.1.67 远程文件只读到首段/截断  | 按远端协议完整分页读取，校验页序、截断重试、内容 SHA 和失败保护；不再把部分内容当完整文件                | 在真实在线 Agent 打开超过单页的大文件，核对开头、跨页位置和末尾    |
| v0.1.70 远程图片粘贴与发送       | 图片只在 `image_input` 能力存在时上传；独立 VM 不污染主进程全局；有任务 ID、进度、真实中止和失败草稿保留 | 粘贴三张真实截图、取消一次、重试一次，并确认远端 Agent 能识别图片  |
| v0.1.70 远端退出后 Studio 假运行 | “停止等待”只收敛当前 request/trace 的 Studio 投影；迟到事件不能重新激活；重启后遗留 active 自动收敛      | 远端进程退出后点击“停止等待”，确认恢复发送且 UI 明示远端未被取消   |
| v0.1.71 realtime 启动异常风暴    | 腾讯 SDK 隔离 VM 补齐 `navigator`；连接失败完整释放 transport/SDK/WebSocket/定时器；跨 VM 错误保留信息   | 保留两个远程项目重启，确认 realtime 在线且不再连续产生未捕获异常   |

远程停止的产品边界没有改变：当前协议没有绑定具体远端 Run 的可靠 cancel capability。“停止等待”不是
真正取消远端任务，不能在验收或发布说明中写成“远程 Agent 已停止”。

## 工程验证（独立审查修复后）

- `pnpm verify`：通过，包含 OSS/package/credential/context/release 边界、format、typecheck、
  lint、完整测试和 build。
- `CCLINK_API_URL=off pnpm smoke:local`：11/11 通过。
- `CCLINK_API_URL=off pnpm smoke:ui`：12/12 通过。
- `CCLINK_API_URL=off pnpm smoke:workflow`：14/14 通过。
- 默认配置 `pnpm smoke:ui`：12/12 通过，远程入口显示局部登录界面。
- `pnpm verify:credential-boundary`：通过；应用运行时不访问系统钥匙串，正式 Release 签名边界
  由 ADR 0011 和受保护 GitHub workflow 独立负责。

## overlay 结论

暂时不能停止旧 commercial overlay 出包。独立代码审查发现的桌面端缺口已经补齐并通过自动
门禁，但新增的审批/提问、草稿重启恢复、会话历史保留、PTY 重挂载和远程项目移除仍未在同一
真实在线 Agent 上完成客户端验收。统一 Studio 的正式包恢复 Developer ID 签名与 Apple 公证；
自动更新仍须以新修复版完成真实旧版升级验收后才能重新声明闭环。云服务付费门禁仍没有实际
拒绝证据，不能宣称收费闭环，更不能由桌面端代替。

## 2026-08-17 最近会话一致性问题

用户截图确认本地工作空间使用顶部横向最近会话，而远程工作空间在 Agent 工具栏使用原生
下拉框，并同时出现两个作用域不清楚的“＋”。问题记录、统一方案和真人验收动作见
`docs/features/recent-session-switcher.md`。RS-1 已完成代码接入；在已登录、已配对在线 Agent
上完成远程新建、首条消息自动标题、快速切换和离线历史查看前，只能声明工程实现完成，不能
声明远程用户闭环完成。
