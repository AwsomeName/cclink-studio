# Historical: Remote Program Milestones

> 当前状态：历史推进计划，不再作为 `cclink-studio` 当前事实源。
>
> 本文的 DeepInk / private-serv / chatcc-agent 三方计划已被 CCLink Studio 新边界取代。官方商业推进应在 `/Users/apple/Desktop/cclink-dev` 协调；云函数在 `/Users/apple/Desktop/chat-cc/deploy`；Agent runtime 在 `/Users/apple/Desktop/chat-cc/Agent`。

# Remote Program Milestones

> 状态：跨项目推进计划
> 最后更新：2026-07-15

## 总原则

不要按仓库推进，要按能力闭环推进。

每个里程碑都必须同时回答：

- DeepInk UI / IPC 做什么？
- private-serv 授权 / token 做什么？
- chatcc-agent runtime 做什么？
- 怎么联调？
- 怎么验收？

## P0：总控项目空间

目标：停止散点开发，把 Remote 纳入统一项目管理。

DeepInk：

- 建立 `docs/remote-program/`。
- 明确 contracts、matrix、debug playbook。
- 把旧 `remote-codex-workspace-plan.md` 作为产品详细方案，Remote Program 作为总控入口。

private-serv：

- 接收 `private-serv-requirements.md`。
- 明确 entitlement、pairing、remote token、后台诊断接口计划。

chatcc-agent：

- 接收 `agent-requirements.md`。
- 明确 capability probe、协议版本、文件/Terminal/Agent session 计划。

验收：

- 三个项目都能指向同一份能力矩阵。
- 任一任务都能归到矩阵某一行。

## P1：协议兼容与能力探测

目标：DeepInk 知道远端 agent 是什么版本、支持什么能力、为什么不能用。

DeepInk：

- `RemoteStatus` 增加协议兼容检查结果。
- Settings 诊断页显示 agentVersion、protocolVersion、升级提示。
- capability 缺失时显示来源：entitlement、protocol、agent runtime、workspace policy。

chatcc-agent：

- 实现 `server_meta` / `capability_probe`。
- 上报 `protocolVersion`、`agentVersion`、runtime probe。
- 输出 verbose diagnostic command。

private-serv：

- agent binding 记录 agent version、protocol version、lastSeen。

验收：

- 旧 agent 会显示“需要升级到 X”，而不是只显示不可用。
- 新 agent 能显示文件、Terminal、Agent session 真实 capability。

## P2：文件写入闭环

目标：远程文件从只读进入安全写入。

DeepInk：

- 远程编辑器保存走 `remote.writeFile`。
- 创建、重命名、删除接权限确认和审计。
- UI 明确显示只读、可写、写入失败原因。

chatcc-agent：

- 实现 `file_write`、`file_create`、`file_rename`、`file_delete`。
- 实现 path allow/deny 和 deny reason。
- 返回统一 RemoteError。

private-serv：

- 下发 `remote_file_write` entitlement。
- token scope 包含 workspace 和 file write scope。

验收：

- 修改远程 Markdown / TS 文件并保存成功。
- path deny、entitlement deny、agent offline、protocol incompatible 都能区分。

## P3：远程 Terminal 闭环

目标：Terminal Tab 能在远端 workspace root 执行命令。

DeepInk：

- Terminal runtime 按 `workspaceRef` 路由 local/remote。
- 远程命令进入确认、风险判断、审计。
- 输出、退出码、错误进入 Terminal state。

chatcc-agent：

- 实现 terminal command 协议。
- 支持 cwd、stdout/stderr、exitCode、timeout、cancel。
- PTY 作为增量 capability。

private-serv：

- 下发 `remote_terminal` entitlement。
- remote token 包含 terminal scope。

验收：

- 远程 Terminal 执行 `pwd` 返回 workspace root。
- 破坏性命令必须确认。
- 离线/超时/无权限/无 capability 可区分。

## P4：远程 Agent Session 闭环

目标：DeepInk 在远程 workspace 启动或连接 Codex / Claude Code。

DeepInk：

- RemoteProvider 暴露 `createAgentSession`、`sendAgentMessage`、`subscribeEvents`、`cancelSession`。
- 远端事件流映射到现有 conversation model。
- 右侧 Agent Panel 显示运行位置、backend、workspace、权限模式。

chatcc-agent：

- 实现 Codex / Claude Code runtime probe。
- 实现 session create、message send、event stream、approval request、cancel。
- 事件覆盖 text、thinking、tool_use、tool_result、command、file_change、approval、error。

private-serv：

- 下发 `remote_agent_session` entitlement。
- remote token 包含 agent session scope。

验收：

- 用户让远端 Codex/Claude Code 读取项目文件，事件流显示在 DeepInk。
- approval 能在 DeepInk 批准/拒绝并反馈给远端。
- 远端没装 runtime 时不降级成本地 backend。

## P5：发布诊断与灰度

目标：Remote 可以支持真实用户和真实服务器。

DeepInk：

- 导出 Remote 日志，不泄露敏感信息。
- 打包版连接 staging Remote。
- Settings 诊断支持复制报告、最近错误、traceId、恢复动作。

private-serv：

- 后台可查 entitlement 命中、token 签发、pairing 状态、agent 绑定、失败码。

chatcc-agent：

- 支持 verbose log、diagnostic command、协议兼容检查。
- 日志可按 traceId 搜索。

验收：

- 任一失败都能定位层级和下一步动作。
- 三项目日志能按 traceId 串起来。

## P6：Direct Transport

目标：在 CCLink Remote 闭环后复用同一 runtime 协议接入 Direct。

规则：

- Direct 只能是 transport/provider 差异。
- Direct 不能另起第二套 agent。
- Direct 和 CCLink 在 UI 上表现一致，只显示 transport badge 不同。

验收：

- 同一 DeepInk 可同时存在 CCLink remote 和 Direct remote。
- 上层文件、Terminal、Agent session 代码不关心 transport。

## 拷问

P1-P5 没闭环前，不建议开 P6。

Direct 很诱人，但它会放大协议债。如果 CCLink 下的 runtime 协议都没统一，Direct 会把问题复制一遍。
