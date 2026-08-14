# ADR 0012：受控的平级 ACP Runtime

- 状态：accepted
- 日期：2026-08-14
- 负责人：CCLink Studio Maintainers
- 复审：ADR 0006 中“ACP Client 与外部 Agent 协议是非目标”的条款

## 问题

Studio 当前以本地 Claude Code / Claude Agent SDK 作为唯一完整工具 Agent。用户需要在保留
Claude Code 默认、直接接入和稳定行为的同时，在单个 Thread 中显式选择 Codex。Codex 官方
ACP adapter `codex-acp` 可以通过本地 stdio 提供会话、流式事件、取消和权限请求，但它同时
引入新的本地可执行文件、进程生命周期、认证、沙箱和会话兼容边界。

ADR 0006 为避免任意 Agent、公共 Registry 和第二套产品状态进入 Studio，曾把 ACP 整体列为
非目标。现在的需求不是开放通用 Agent 平台，而是增加一个有名称、固定实现、可探测且可止损
的 Codex Runtime，因此需要对该非目标做最小例外，而不是推翻 ADR 0006 的状态所有权原则。

## 用户验收目标

1. 新建 Thread 仍默认直接使用 Claude Code，历史 Thread 无需迁移操作；
2. 空 Thread 可以在首次发送前选择 Codex（ACP），发送后绑定不能原地切换；
3. Codex 在当前本地工作空间完成真实文本流、文件任务、权限拒绝、取消和会话恢复；
4. ACP 缺失、认证失败、协议不兼容或进程崩溃时，只影响对应 ACP Thread，Claude Code 和其他
   本地工作台能力继续可用；
5. Studio 不读取用户已有 Codex 登录、不使用系统钥匙串，也不把任意外部 Agent 当作可信实现。

## 决策

1. Claude Code 与 ACP 是 Thread 产品模型中的平级 Runtime 选项，但 Claude Code 仍是 Agent
   能力的必备启动基线和所有新 Thread 的固定默认值。Claude Code 不可用时 Agent 整体降级；
   ACP 不作为启动兜底。
2. Claude Code 继续直接使用 Claude Agent SDK，不通过 ACP，不由 ACP 代理，也不为了协议统一
   先迁移稳定事件链。
3. 首版 ACP 只允许本地 stdio 和实现 ID `codex-acp`，固定验证
   `@agentclientprotocol/codex-acp@1.3.0`。不开放公共 Registry、任意 command/args、远程 URL
   或第二个 ACP Agent。
4. Runtime 绑定属于 Thread。缺少绑定的历史和新建 Thread 均按 Claude Code 读取；只有没有
   发送过消息的 Thread 可以选择 Codex，首次发送后锁定。
5. `sessionId`、兼容指纹、run、权限和诊断继续由现有 Studio Agent 领域拥有。ACP session ID
   只作为绑定 ACP Thread 的原生恢复引用，不成为第二份 Thread 状态。
6. ACP 事件使用带版本标识的最小中性投影；renderer 首版显式兼容 Claude legacy 事件和 ACP
   中性事件，不先重写 Claude backend。
7. Codex ACP 使用独立 `CredentialService` 凭证。子进程使用隔离 `CODEX_HOME`、`NO_BROWSER=1`
   和工作空间受限模式，不继承其他模型凭证，不读取 `~/.codex`，不设置 `CODEX_PATH`。
8. ACP 权限首版只允许一次性批准和拒绝；只有不扩张 workspace、network 或命令策略边界时才
   可允许会话级批准。Full Access、额外 writable root、网络和策略 amendment 不进入首版。

## 不变量

1. ACP 不位于 Claude Code 上层，Claude Code 的启动、会话和事件路径保持直接。
2. ACP 故障不得使 Claude Code 或非 Agent 工作台能力降级。
3. renderer 不能提交任意 executable 参数、环境变量、远程地址或未校验 runtime ID。
4. 主进程仍是 Thread/run/session 绑定、权限关联、生命周期和诊断的唯一运行事实源。
5. 凭证只进入 `CredentialService` 和目标子进程环境，不进入普通设置、Thread、工作空间或诊断。
6. ACP 协议权限不能替代进程沙箱；无法阻止 workspace 外写入时停止实现。
7. 第二个 ACP Agent、自动安装、ChatGPT 登录、远程 transport 和 Registry 都需要新的产品证据
   与单独复审。

## 备选方案

- **让 ACP 成为 Claude Code 上层**：拒绝。会破坏已稳定的默认路径并扩大回归面。
- **Claude 和 ACP 完全独立启动**：拒绝作为首版。Claude Code 是明确的最低 Agent 基线；拆分
  启动状态和全局能力只会扩大当前实现。
- **直接接 Codex App Server**：作为 D0 失败后的替代路径保留；它不能被宣称为 ACP 支持。
- **开放任意 ACP executable**：拒绝。协议握手不能证明本地进程可信或遵守 Studio 边界。
- **先建设 Runtime Registry**：拒绝。一个固定 ACP 实现不需要通用注册、进程池或插件系统。

## 风险与影响

- `codex-acp` 是运行在用户权限下的可信本地进程；Studio 只能结合 Codex sandbox、环境隔离和
  负向验收降低风险，不能把协议确认 UI 描述成安全沙箱。
- Claude 与 ACP 在 renderer 暂时存在两种显式事件输入，形成有边界的迁移债务；首版以保护
  Claude 稳定路径为优先，不能用抽象纯度扩大前置工作。
- 用户自行安装的 adapter 可能漂移版本。首版以真实探测结果和兼容版本为准，不按命令名称
  推断可用。
- 一条活动 ACP Thread 一个 adapter 进程会增加资源占用，但比首版进程共享和路由池更容易
  保证会话归属与故障清理。

## 迁移计划

1. 完成固定版本 adapter 的 D0 initialize、认证、prompt、取消、权限、恢复和沙箱探针；
2. 在现有 `IAgentBackend` factory 中增加 `local-acp`，按 Thread binding 创建 backend；
3. 增加 Codex ACP 路径、独立凭证、空 Thread 选择和 ACP 中性事件消费；
4. 完成真实工作空间任务、失败隔离和重启恢复后，再接一个 Studio MCP 工具；
5. 没有第二个真实 Agent 需求前，不抽取通用 Registry 或公共 ACP 配置模型。

## 回收或复审条件

- `codex-acp` 无法稳定完成 prompt、cancel 或 session 恢复；
- workspace 外写入必须依赖 Full Access，或权限请求无法与当前 run 可靠关联；
- API Key 隔离后仍读取用户 Codex 登录或系统凭证；
- ACP 故障会影响 Claude Code 的默认路径；
- 需要支持第二个 Agent、远程 ACP、自动安装或 ChatGPT 登录。

## 验证

- D0 探针固定 adapter 版本并记录无敏感信息的 initialize/capability 结果；
- 单元测试覆盖 runtime binding、历史 Thread 默认、session 指纹隔离和事件终态竞态；
- 真实 App 验收 Claude 默认、Codex 文本、工作空间文件任务、权限拒绝、取消和恢复；
- 坏路径、断网、进程崩溃和不兼容版本只使 ACP Thread 降级；
- `pnpm verify` 和受影响 smoke 通过后才能声明工程门禁完成。
