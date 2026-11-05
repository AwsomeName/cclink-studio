# CCLink 远程第一阶段验收记录

> 日期：2026-08-13，最近补充：2026-11-06。状态：用户已在 0.1.29 真实 App 中登录并打开远程
> 项目；v0.1.65-v0.1.71 又完成审批、分页读取、图片输入、停止等待和 realtime 启动的工程修复，
> 这些新增能力仍待同一真实在线 Agent 回归。

## 用户验收目标

> 用户启动 Studio，不登录也能打开本地项目；点击 CCLink 远程入口后登录，选择在线设备和远程目录，打开并读取一个文件。

## 2026-11-06 首次计划审批卡被丢弃

用户功能进度：0.1.127 的真实截图与日志显示 `ExitPlanMode` 持续等待而没有确认卡。
修复已在隔离 Electron 中验证确认卡出现、点击后等待回执、回执到达后关闭及后续结果展示；
远端传输使用夹具，真实在线 Agent 的审批与继续执行尚未验收，也尚未发布此修复。

已确认的工程根因：同一工具先收到 `executing`，随后收到
`pending + requires_approval=true` 时，旧逻辑把“尚未要求审批”误当成“审批已处理”，
在主进程直接丢弃首次审批。使用 v0.1.127 源码重放已复现；直接收到审批的对照组正常。

修复在现有工具消息内记录与 `requestId` 绑定的 `approvalResolved`，仅匹配 ACK、远端明确
撤销或确认请求已结束时写入；普通执行中事件不产生该事实。字段随现有会话快照保存，
缺失字段的旧快照不推断为已审批。远程会话服务继续作为状态所有者，UI 只呈现审批事实，
`ExitPlanMode` 仍需人工确认，超时和断网仍保留待确认状态，不增加 IPC 或远端协议。

工程验证：

- `cclink-remote-service.test.ts`、`runtime-state-store.test.ts` 和
  `remote-agent-controller.test.tsx` 共 77 项通过；覆盖首次审批、匹配 ACK、重复投递、
  明确撤销、迟到终态、重启保存和新请求隔离。
- `pnpm typecheck` 通过；变更文件的 ESLint、Prettier 检查通过。
- 已运行 `node scripts/remote-tool-approval-smoke.mjs`，真实 Electron、现有主进程服务和
  renderer/IPC 交互通过；远端传输为夹具，结果明确记录 `remoteTransportStubbed: true`。
  脚本要求已运行的开发 renderer，默认 `http://localhost:5173`，可用 `--renderer=URL` 指定；
  使用独立 userData，不登录、不发送真实远程任务。

待执行的真人验收：

1. 使用包含修复的 Studio 连接真实在线 Agent，在独立测试会话中要求先提供只读实施计划。
2. 触发 `ExitPlanMode` 后确认出现一张包含计划的“Agent 请求执行操作”卡，可允许或拒绝。
3. 审核后点击“允许本次操作”，确认先显示等待 Agent 确认；收到回执后卡片关闭，
   Agent 继续并输出最终结果。另一次测试选择拒绝，确认不会继续实施。
4. 确认重复事件或切换会话不会重开已处理卡，网络失败时可重试而非假称批准成功。

已被旧版本丢弃的审批事件不会仅因更新而自动重建；原任务需核对远端是否仍在等待，
不能把“停止等待”当成远端已取消，或通过直接修改本地审批标记强行恢复。

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

1. 打开远程 Markdown，确认标题、强调、列表、表格与代码块默认渲染；切到源码修改，再切回预览
   核对未保存内容，保存并重新打开；随后新建测试文件，重命名后删除；
2. 新建远程 Agent 会话，发送消息并收到流式回复/工具事件；
3. 打开远程 Terminal，执行 `pwd`，断网恢复后确认 PTY attach 和输出续接。
4. 连续触发多次远程 `WebSearch`，确认 Studio 自动批准、不显示逐条确认卡，
   且远程任务继续执行。

## 独立审查后的桌面端补齐记录

- Session 磁盘文件只保留 refresh token；旧 `cclink-user.json` 启动时删除且不读取、不迁移，
  用户资料、access token、IM UserSig 和完整远程身份只驻留当前进程内存。
- 工具审批和 Agent 提问不再以“消息已发送”冒充成功：Studio 等待并校验
  `tool_approval_ack` / `question_answer_ack` 后才更新状态；问题也接受匹配的
  `question_status: resolved` 接收事实，传输错误保持可重试。AskUserQuestion
  使用问题文本作为 answers key，并支持以逗号分隔协议提交多选答案。精确名为
  `WebSearch` 的只读远程工具由 Studio 自动批准；ACK 失败时恢复人工确认卡，
  其他工具的审批边界不变。
- 首次目录浏览触发的 `permission_request` 现在直接显示在远程目录选择器中，无需先打开
  Workspace。远程脏文件重新读取前要求确认；退出 flush 会等待尚在 debounce 窗口内的草稿
  写盘，草稿目录移动/删除按完整 WorkspaceRef 隔离，单次写失败不会毒化后续保存队列。

- 远程文件编辑已接入 `Cmd/Ctrl+S`、未保存关闭确认、部分读取禁止覆盖，以及文件/目录重命名和删除后的 Tab、脏草稿联动。
- 远程 `.md` / `.markdown` 默认进入安全语义预览，可切换源码编辑；预览直接投影当前草稿，原始
  HTML 保持惰性，其他扩展名继续使用纯文本编辑。相对远程图片仍只显示替代文本，不把远程路径
  误交给本地文件 API。
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

## 2026-10-15 远端 Claude CLI 发现失败

### 现象与用户验收

用户在另一台 Mac 的 Studio v0.1.114 中打开远程工作空间 `/home/lc/argus`，连接的 Linux
设备为 `lc-All-Series`，远端 Agent 版本为 `0.8.50`。设备在线、界面显示“Agent 就绪”，但
新建远程会话失败：

```text
Error invoking remote method 'cclink:createSession':
Error: Claude CLI not found. Install it first: npm install -g @anthropic-ai/claude-code
```

本次用户验收动作：在远端处理运行时发现问题，等待 Mac 上设备重新在线，再新建远程会话。
用户执行下述恢复命令后回复“可以了”，确认本次故障恢复。

### 已确认的证据

- 检查对象是远端 Linux Agent；Mac 客户端的 npm、Claude 安装不参与这次远程会话启动。
- 远端用户为 `lc`。直接 SSH 命令可找到 `/usr/bin/node`、`/usr/bin/npm` 和
  `/usr/local/bin/chatcc`，但 `claude --version` 返回 `command not found`。
- `chatcc runtimes` 使用 `/bin/bash -lic` 加载环境后，`claude_code` 为 `status: ok`，
  找到 `/home/lc/.npm-global/bin/claude`，版本为 `2.1.190 (Claude Code)`，adapter 为
  `sdk (primary)`。因此 Claude 已安装且能在该检测环境中运行；其他 15 项运行时缺失不影响
  当前选择的 Claude 运行时。
- `systemctl show chatcc-agent` 返回 `MainPID=0`；实际 `index.js --daemon` 和
  `utility-worker.js` 进程均属于 `lc`。本次不是由 root 运行或活动 systemd 服务导致。
- `chatcc runtimes` 会启动新的检测流程，其成功结果不代表正在服务的后台 Agent 已使用
  相同环境。能力探测的 `ready` 表示探测完成，不能替代 Claude 运行时的预检结果。

### 已验证的恢复操作

等待远端任务结束后，在 **Linux 主机上以 `lc` 用户**执行：

```bash
CLAUDE_CODE_BIN=/home/lc/.npm-global/bin/claude /usr/local/bin/chatcc restart
```

这条命令明确指定已验证的 Claude 可执行文件，并重新启动后台 Agent、检测子进程及运行时
探测。随后回到 Mac，等待设备重新在线，再创建远程会话。该命令中的用户名、Claude 路径和
`chatcc` 路径是本次实测值；其他主机必须替换为该运行用户实际可执行的路径。

### 定位结论与残余边界

已确认的故障范围是远端在线 Agent 的运行时发现或启动预检；显式路径加重启已恢复本次使用。
旧进程的 PATH、原始预检错误和缓存未留证，且恢复同时改变了路径选择与进程状态，因此不能
将“旧 PATH”或“旧探测缓存”单独写成已证实的唯一根因，也不能继续建议重装 npm 或 Claude。
Agent 的预检还会将 CLI 执行失败统一报成 `Claude CLI not found`，该文本本身不证明文件不存在。

命令前的 `CLAUDE_CODE_BIN=...` 只影响本次启动及其子进程，没有写入持久配置；后续普通重启
或机器重启后是否仍可自动发现尚未验证。本次只记录现场恢复，没有修改 Studio、远端 Agent
或云服务代码，也不据此声明自动发现缺陷已永久修复或全部远程能力已完成验收。

## 2026-11-05 远程选择题等待后无法提交

### 用户功能进度

Studio 源码已补齐过期问题的提交反馈，但尚未发布，也未在用户的 `lc-All-Series` 在线设备上
验收超时续接。截图同时显示“市场范围”仍为“请选择”，原界面因此禁用提交却不解释缺项。

只读核对现有 Agent 源码发现：选择题默认等待 5 分钟（可由远端环境配置）；新协议会发送
`question_status`，过期答案可被接受为同一会话的新回合，并返回
`question_answer_ack.status = accepted_as_new_turn`。Studio 原先不识别状态通知，只接受
`accepted`，因此无法正确展示过期和续接结果。此证据不代表用户设备已安装支持续接的版本。

当前修复行为：

- 缺少选择时列出未填问题；收到过期事实后保留已填答案，显示“提交答案并继续”。
- 主进程按设备、会话、原请求和问题标识接收状态；仅在匹配的 ACK 或 resolved 通知后标记
  已接收。续接 ACK 还须包含 `resolution: new_turn` 和新请求 ID。
- 传输超时保留重试入口；远端明确取消或表示问题已不存在时，显示结束及继续对话的提示。
  迟到过期通知不撤销接收事实，重复问题不重开已处理卡片，状态变化不移动卡片。
- 问题状态随原有远程会话文件保存；Studio 不用前端计时推测失效，不修改 Agent 或云服务，
  不改变原任务授权。原回合的继续或新回合的启动仍由远端 Agent 决定。

真人验收步骤（待执行）：

1. 在真实远程会话要求 Agent 提出带单选和多选的问题；漏选一项，确认能看到具体缺项。
2. 填完所有选择，等待超过远端实际配置的问答期限；确认选择仍在且出现过期提示。
3. 点击“提交答案并继续”，确认远端返回接收结果、卡片显示“已提交为新一轮消息”，并在同一
   会话中看到 Agent 根据所选答案继续回复。只出现卡片成功状态不足以通过本项。
4. 对另一问题模拟断网提交，再联网重试；确认答案保留且不会假报成功。对已经取消或远端
   不再保留的问题，确认给出明确原因及消息框继续入口。

### 工程准备度

- 相关协议、持久化、面板和 renderer store 单测通过（112 项），覆盖续接 ACK 校验、迟到
  通知、重复问题、ACK 丢失、传输失败、旧协议超时终态与重启后的状态恢复。
- `node scripts/remote-question-smoke.mjs` 已通过；隔离 Electron 中点击填写单选和多选、
  注入过期状态、模拟传输失败重试及续接确认，验证答案保留和按钮反馈，并生成截图与结果。
  该 smoke 使用模拟远端事件，不访问真实账号或模型，不替代上述真人验收。

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
