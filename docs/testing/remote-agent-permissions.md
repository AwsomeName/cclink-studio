# 远程 Agent 统一权限验收

## 用户可执行验收

1. 打开已登录、已配对、在线的远程工作空间，新建会话。在输入框权限菜单选择“严格”，要求读取一个项目文件并创建一个临时文本文件，确认操作进入等待卡片。
2. 切换“除删除/终止外自动”。已有的常规请求应自动继续；接着要求读取、编辑该临时文件并运行项目测试，常规调用不再逐个询问。菜单与设置页显示一致，重启后模式保留。
3. 要求删除上述临时文件。Studio 必须再次显示确认及删除原因；先拒绝，确认远端返回拒绝且文件仍在。再次提出删除，应重新确认，先前批准不形成删除类长期授权。
4. 在等待确认时切换工作空间，确认操作仍属于原设备、工作空间、会话和请求。停止等待或归档会话后，旧卡不能继续批准；重新连接不得从磁盘历史自动批准旧请求。
5. 人为断开远程网络，审批未收到匹配 ACK 时不得显示已批准；恢复后根据新请求重新判断。普通工具成功不能代替真实执行结果，审批 ACK 只证明决定已接收。

以上真实在线设备验收尚未执行。工程验证与真人闭环分开记录。

## 实现边界

- `PermissionManager` 持有既有全局权限模式，`SettingsService` 持久化；远程输入框复用本地权限菜单。切换会影响本地与远程，界面明确标示作用域。
- `AgentToolAuthorizationBroker` 唯一拥有策略。远程 service 仅持有本轮活跃的审批上下文、投影确认卡和传送决定；不引入第二套策略或向 Agent 下发权限模式。
- `automation-runtime` 注入既有 ToolHost；初始化失败时远程保留单次人工确认，本地其他能力不受影响。绑定和模式监听在 teardown 中释放。
- 只有所属设备、工作空间、当前 Studio 发起的运行与请求均匹配时才自动回复。停止跟踪、归档、断线、结束和重启使旧的自动授权上下文失效；异步连接及能力查询后、发送前重新核对当前策略。
- 常规 SDK 工具复用既有分类和删除/终止识别，不另加“远程一律确认”的规则。远端 ACP 的 `tool_kind=delete/move`、额外确认标记、截断输入、未知工具、缺失编辑内容、路径越界和未覆盖的 Shell 继续人工确认。远端同名 MCP 不享受本地 loopback 工具豁免。本地“始终允许”的内存记录不外溢到远程。
- 自动策略回复 `explicit_user_decision: false`，用户点击回复 `true`。只有匹配 ACK 或远端执行事件可以结束审批；网络超时保留确认，重复事件不触发自动重试风暴。
- 自动模式只决定 Runtime 已上报的工具请求，不能约束 Runtime 未上报的操作，也不是远程沙箱。路径检查是词法检查，不能解析远端符号链接；命令识别不能透视脚本文件和构建工具内部行为。现有远端身份、工作空间及 Runtime 安全边界保留。
- 不修改 `cclink-agent`、云端、发布链路，也不消除逐工具的网络往返。

## 工程验证

- `remote-tool-authorization.test.ts`：真实 broker 与 PermissionManager 经远程 service 的授权矩阵、连续操作、来源标记、拒绝、模式切换、跨作用域、过期、停止、断线和传输失败。
- 既有 remote service 测试：ACK 匹配、迟到结果、重复事件及多工具独立 request ID。
- `node scripts/remote-tool-approval-smoke.mjs --renderer=http://127.0.0.1:5173`：隔离 profile 中的真实 Electron、现有 IPC/settings、共享菜单及远程 controller；远程 transport 使用 fixture，不发送真实远程任务。覆盖严格模式三张卡、切换自动后连续放行、删除拒绝、设置持久化及原有 ACK/replay 行为。

2026-11-10 验证结果：

| 范围 | 结果 |
| --- | --- |
| 受影响的 20 个测试文件 | 通过；含最终补充共 357 项不同测试，远程统一权限专项 34 项 |
| `pnpm build`（含前后端类型检查） | 通过 |
| `pnpm lint`、改动文件 Prettier、`git diff --check` | 通过 |
| Electron 专项 smoke | 通过；远程传输为 fixture，不代表真实在线设备通过 |
| 隔离 profile 的 `settings.json` | 已核对持久化为 `auto-except-destructive` |
| 真实在线 Agent 的连续操作和删除拒绝 | 待验收 |

本机最新 smoke 证据目录：
`/var/folders/4z/030bqrj52qn9vpf4w6hydk_c0000gn/T/studio-tool-approval-3WZGNy`。
其中 `result.json`、`strict-three-confirmations.png`、`automatic-regular-tools.png`、
`delete-still-confirmed.png` 分别记录检查结果、严格模式、自动放行及保留删除确认。

## 正式发布前的侧栏布局回归

2026-11-10 远端 UI smoke 发现：349px 侧栏中，本地角色按钮已收为 28px 图标，远程角色按钮仍保留文字、宽 61px。统一权限菜单增加后，远程工具栏因此换行至 78px，输入卡片增至 156px；本地仍分别为 42px 和 120px。

修复仅让远程角色按钮复用既有 `agent-profile-btn` 紧凑样式，不改变权限策略或布局断言容差。新增侧栏角色按钮宽度一致断言。隔离配置的真实 Electron `--agent-panel-only` smoke 4/4 通过；本地与远程角色按钮均为 28px、工具栏均为 42px、输入卡片均为 120px，侧栏与中央面板的既有断言保持通过。

本机证据：`/tmp/cclink-composer-release-136/agent-panel-side-projections.json`。这项布局验证不替代真实在线设备权限验收。
