# ADR 0019：冻结 cclink-agent 本地 Runtime 统一路线

- 状态：accepted；当前路线已关闭并冻结
- 日期：2026-08-25
- 负责人：CCLink Studio Maintainers
- 影响：冻结 ADR 0018 之后的默认切换、运行控制和工具桥接工作；已完成的默认关闭实验实现暂不删除

## 用户原始需求与目的

最初的用户需求不是更换 Studio Agent，而是：用户登录 CCLink 后，本机 Studio Agent 任务结束时，
能够向该用户的 CCLink 手机 App 发送消息；用户未登录时，Studio 的全部本地能力仍然免费、完整、
可用。

讨论随后暴露出 Studio 本地 Agent 与 `cclink-agent` 同时存在。为了减少一套产品内的重复 Runtime、
通信和维护成本，路线一度扩大为“让 Studio 复用 `cclink-agent` 执行本地模型任务”。期望达到：

- Studio 继续提供唯一桌面工作台和免登录本地体验；
- `cclink-agent` 复用已有 Runtime 与通信能力；
- 不再额外维护 ACP 等并行 Agent 接入路线；
- 登录 CCLink 后，可在同一通信链路上继续承载手机消息或远程入口。

这次扩大不是原始通知需求的必要前提，而是一次 Agent 统一方向的架构探索。

## 探索过程

先后讨论和排除了以下方向：

1. **强制 Studio 登录**：与开源 Studio 的免登录本地能力冲突，未采纳。
2. **新增 cclink-agent“嵌入 Studio 模式”**：会增加专用生命周期和产品耦合，未采纳。
3. **在 Studio 内独立重做 CCLink 通信和 Runtime**：会继续保留两套 Agent，未采纳。
4. **复用现有 `chatcc cclink-studio` loopback HTTP/SSE 服务**：作为默认关闭实验被 ADR 0018
   接受，用于验证 Studio 是否能够把 `cclink-agent` 当作文本 Runtime 适配器，而不改变默认后端。

实验过程中，Studio 仍然拥有 Thread、消息、Workspace、run ledger、终态、Session 绑定和界面；
`cclink-agent` 只执行实验 HTTP 请求。为了继续走到默认切换，还需要设计精确取消、断线状态、
工具调用、MCP 和权限确认等跨进程控制协议。路线由“复用 Runtime”逐渐扩大成让
`cclink-agent` 参与 Studio 本地 Agent 的控制面，复杂度和状态所有权风险明显上升。

## 已完成事实

截至 2026-08-25，以下工作已经完成并保留为可复核证据：

- `chatcc-agent 0.8.49` 已发布，现有 SSE 成功终态能够返回真实 `runtime_session_id`；
- Studio 已实现默认关闭的实验性 `cclink-agent` backend；
- Studio 能启动和退出 `chatcc cclink-studio` loopback 子进程，token 只驻留内存；
- 未登录 CCLink、无 `cclink-session.json` 的真实 Electron 环境中，首轮文本流、Session ID 保存、
  同一 Thread 第二轮续聊均已通过；第二轮能够回答首轮记录的“海盐蓝”，run 为 `succeeded`；
- Studio 退出后没有残留 `chatcc cclink-studio` 进程；
- 不带实验环境变量启动时仍使用 `local-claude-code` 默认后端；
- `pnpm smoke:cclink-agent`、相关定向自动化、脚本语法、Prettier 和 `git diff --check` 已通过。

上述结果只证明文本 Runtime 适配路线可行，不代表 Agent 已统一，也不代表可以切换默认后端。

- 用户功能进度：`0%`。手机尚不能收到 Studio 本地任务状态或结果。
- 工程准备度：两轮文本/Session 实验已通过并留存证据，但该路线已冻结，不继续补齐控制面。

## 尚未完成

- 原始“本机任务结束后向已登录用户的 CCLink App 发消息”功能尚未实现；
- 实验 backend 没有按具体 run 精确取消和服务断线后的状态对账；
- Studio 工具、MCP、权限确认、Browser、Editor、Terminal、图片、角色、Skills 和定时任务没有通过
  `cclink-agent` 形成产品闭环；
- `cclink-agent` 没有成为 Studio 默认后端；
- Studio 原有本地 Agent/Claude Runtime 没有迁移或移除；
- 两套 Agent 的长期产品关系仍未形成最终决策。

这些内容从本 ADR 生效起不再作为当前开发队列，也不得描述成当前版本的阻塞 bug。

## 决策

1. 冻结“让 `cclink-agent` 成为 Studio 本地默认 Runtime/控制面”的继续迁移。
2. 不再为该路线继续增加 cancel、status、run 恢复、工具执行或权限控制接口。
3. 不切换 Studio 默认后端，不移除现有本地 Agent，不把实验开关升级为产品设置。
4. ADR 0018 的实验代码、测试和真实验收记录暂时保留，默认关闭；冻结不等于立即回滚或删除。
5. 冻结期间不因该实验修改 `chatcc-agent`、发布新版本或扩张 CCLink 登录权限。
6. 原始通知需求一并暂停，不以“先完成 Agent 统一”为前置任务继续推进。
7. 上述转发定位只约束 Studio 本地任务同步场景，不取消 `chatcc-agent` 在没有运行 Studio 的
   远程电脑上作为独立 Runtime 的现有职责。

## 后续重新评审的默认方向

如果未来明确恢复这项工作，默认先评审更窄的职责边界：

```text
Studio 本地 Agent：任务、Runtime、工具、权限和终态的唯一控制者
        ↓ 仅发送有边界的任务事件
cclink-agent：在 Studio 同步场景只负责登录后的消息转发与设备通信
        ↓
CCLink App：接收通知或远程消息
```

该方向下，`cclink-agent` 不创建、不取消、不恢复 Studio 本地 run，也不拥有 Studio Thread、
Session、工具或权限状态。未登录、网络离线、token 失效或转发失败只影响消息送达，不影响本地任务。
正常远程主机 Agent 的 Runtime、文件和 Terminal 产品职责不受本 ADR 影响。

这只是下次复审的默认出发点，不是已经授权实施的设计。恢复前仍需重新确认：用户可见验收动作、
消息内容和隐私边界、登录与退出语义、失败降级、重试/去重、服务端授权及是否值得继续投入。

## 当前产品事实

- 普通用户继续使用 Studio 现有本地 Agent，免 CCLink 登录；
- CCLink 远程入口仍按现有登录和远程协议工作；
- 实验 `cclink-agent` backend 只有显式环境变量才能启用，不是正式产品承诺；
- 没有可对用户宣称的本地任务完成通知能力；
- 本 ADR 之后若无新的明确决策，不得继续推进 Agent 默认切换或本地控制协议。

## 恢复条件

只有用户明确解除冻结，并接受一份新的 ADR 后才能恢复。新 ADR 必须先回答：

- 是否只做消息转发，而不迁移本地 Runtime；
- 用户不登录时的完整降级行为；
- Studio 与 cclink-agent 各自唯一拥有的状态；
- 最小真人验收动作以及停止投入的条件。
