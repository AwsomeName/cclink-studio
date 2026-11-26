# ADR 0027：Owner 按工作类型选择运行时顺序

- 状态：accepted（2026-11-26 用户确认 Owner 事务官设计：角色不按厂商写死，参考"在合适的任务上用合适的人"）
- 补充 ADR 0023：Owner 事务的新会话不再固定 Codex 优先，而是按 Owner 设置里该工作类型的顺序探测。其余自主任务（含公司决策）保持 ADR 0023 的 Codex 优先。

## 用户验收

在 Owner 设置的"运行时分工"里把"检索取证"的首选改成 Claude Code，新交办的事务派出执行会话 A 时使用 Claude Code，约定和事务进度的"分工"里写明"检索取证首选 Claude Code"。把首选设成未就绪的运行时，A 改用备选，并写明"首选 X 未就绪，按顺序改用 Y"。没有备选且首选未就绪时，派工报错，事务停在需要处理，不假成功。已有会话不换运行时。

## 选择与边界

- 工作类型目前只有两个：统筹（Owner 自己的会话）和检索取证（执行会话）。独立构思、写作文案、审查核对等在对应步骤落地时再加入，不提前出现在设置里。
- 顺序保存在 `userData/owner-directories/preferences.json` 的 `runtimes`，由主进程 `OwnerPreferences` 唯一写入；缺省为统筹 Claude Code → Codex，检索取证 Codex → Claude Code。
- renderer 只传工作类型，不传运行时清单；主进程读取顺序后复用 AgentBridge 的同一启动探测（Codex 只读 4 秒探测、Claude 检查 Studio Key 与可执行文件），不发模型请求，不迁移已有原生 Session。
- 选择结果与原因写入事务记录（Owner 会话 `research.owner`，执行会话 `workers[].agentWhy`）和工作记录；它们是展示快照，不是第二个运行时状态所有者。
- 不涉及凭证存储变化，不使用系统钥匙串。

## 验证与降级

- 单测覆盖：顺序探测（Claude 优先时不探测 Codex、Claude 不可用时回落 Codex）、偏好默认值与更新、重复项拒绝、原因文案。
- 偏好文件缺少 `runtimes` 时按缺省顺序工作；IPC 不带工作类型时保持 ADR 0023 行为。
