# ADR 0006：自有 Agent Runtime 与模型服务适配边界

- 状态：accepted
- 日期：2026-08-07
- 负责人：CCLink Studio Maintainers

## 结论

CCLink Studio 的产品能力是由 CCLink 提供一致的 Agent Runtime，用户只选择受支持的
模型服务、模型和本地凭证。Thread、上下文、工具循环、MCP、权限、角色、调度、诊断和
用量事实由 CCLink Agent 领域拥有，不能随模型服务更换而更换产品语义。

ACP（Agent Client Protocol）、用户自带 Agent 可执行文件、Agent Registry 和外部 Agent
框架接入不进入当前产品路线。技术上可以连接外部 Agent，不等于目标用户获得了值得承担
新信任边界、生命周期和支持矩阵的产品价值。

当前实现仍以本地 Claude Code / Claude Agent SDK backend 为唯一完整工具 Agent 主线。
本 ADR 接受未来的产品与架构方向，不代表自有模型循环或多模型完整工具 Agent 已经交付，
也不取代 ADR 0002 对 Claude Code Runtime 来源、打包、认证、切换和诊断的约束。

## 用户目标与端到端验收

目标能力完成后，用户必须能在真实应用中执行以下动作：

1. 在设置中选择一个受支持的模型服务协议，填写端点、模型和本地凭证，并看到真实的
   连通性与能力检查结果。
2. 在原有 CCLink Thread 中发送任务，继续使用同一套 Browser、Editor、FS、Terminal、
   Android 和其他 MCP 工具，不需要理解或安装另一套 Agent。
3. 工具调用继续经过 CCLink 的工作空间边界、权限策略和不可逆外部副作用最终确认；模型
   服务不能通过 Provider Adapter 获得绕过这些边界的执行入口。
4. 流式输出、取消、图片输入、上下文占用、用量事实、错误和诊断保持统一产品语义；模型
   服务不支持的能力必须在发送前明确降级，不能运行到一半才伪装成功。
5. 切换模型服务时，运行中的任务不被静默中断。旧服务的原生 Session 不兼容时保留
   CCLink Thread 可见历史，并明确从新模型上下文继续，不伪造无损恢复。
6. 模型服务不可用时只使 Agent 降级，工作空间、浏览器、编辑器、Terminal 和 Android
   继续启动和使用。

在上述真实应用验收完成前，只能声明模型适配 contract、测试或工程门禁完成，不能声明
“CCLink 自有多模型 Agent”已经交付。

## 问题

当前产品已经拥有 Agent Panel、Thread、工具桥接、权限确认、角色、调度、诊断和工作空间
恢复，但完整工具 Agent 实际由 Claude Code / Claude Agent SDK 驱动。现有 Provider 设置
主要向 Claude Code 子进程注入 Anthropic-compatible 端点、模型和凭证，并不等于 CCLink
已经拥有供应商无关的模型循环。

如果为了“可扩展”直接增加 ACP 或其他外部 Agent 框架，用户选择的不再只是模型，而是
另一套会话、工具、权限、认证、更新和故障语义。任意本地 Agent 进程还可能直接使用操作
系统文件和 Shell 权限，绕过 Studio 的 MCP 与人工确认。ACP 的协议级权限请求不能替代
进程隔离，也不能证明所有第三方 Agent 都遵守 CCLink 的产品不变量。

产品需要解决的是模型服务可选择，而不是让用户把另一套 Agent 带进 Studio。两者必须在
架构和路线图中明确分开。

## 决策

### 1. CCLink Agent Runtime 拥有产品语义

以下能力由主进程 Agent 领域拥有，并保持单一事实源：

- Thread 与运行中的 run/session 映射；
- 上下文构造、连续性、压缩和恢复判断；
- 模型请求与工具结果之间的 Agent loop；
- MCP 工具暴露、workspace/scope 绑定和 allowlist；
- 权限策略、用户确认和不可逆外部提交边界；
- 角色、定时任务策略、取消、错误、诊断和用量事实。

renderer 只保存消息和可见运行投影。Provider Adapter 不得拥有第二份 Thread、工具权限、
调度状态或恢复事实。

### 2. 模型服务通过有界 Adapter 接入

未来模型服务抽象以能力为中心，而不是以营销供应商名称为中心。Adapter 只负责：

- 认证后的模型请求；
- 文本与受支持多模态输入；
- 流式内容与结构化工具请求；
- 工具结果回送；
- 取消、停止原因、上下文/用量事实和结构化错误归一化。

每个 Adapter 必须声明并验证自身支持的 streaming、tool calling、images、usage、context、
cancellation 等能力。不得因为端点声称“OpenAI-compatible”就默认具备完整工具 Agent
所需语义。

Adapter 不直接调用 Browser、FS、Terminal 或其他业务服务，不持久化普通设置之外的
第二份产品状态，不把凭证、原始响应或思维内容暴露给 renderer。

### 3. 当前 Claude Code 主线继续受保护

在供应商无关的模型 Adapter 和 Agent loop 形成真实纵向闭环前：

- 本地 Claude Code backend 继续是完整工具 Agent 的唯一已交付主线；
- `bundled`、`system`、`custom` 仍只表示 Claude Code Runtime 来源；
- ADR 0002 的 runtime fingerprint、探测后提交、认证、会话兼容和失败降级继续有效；
- 不把设置中的 `http-api` 兼容字段或普通 HTTP Chat 声明为完整工具 Agent；
- 不为追求抽象纯度提前移除稳定 Claude Code 路径。

### 4. 外部 Agent 协议是非目标

当前不实现或承诺：

- ACP Client、ACP Agent 安装或 ACP Registry；
- 用户自定义 Agent command、可执行文件或远程 Agent endpoint；
- 外部 Agent 自己拥有的工具、权限、Thread 或长期记忆；
- 以 A2A、ACP 或供应商 Agent SDK 作为 Studio 内部状态协议；
- 为不同 Agent 框架维护功能相似但语义不同的 Agent Panel。

模型供应商提供的 SDK 只有在可被限制为模型传输 Adapter、且不接管 CCLink 产品状态时才可
采用。接入新的 Agent 框架必须重新评审本 ADR，不能伪装成普通 Provider 增量。

### 5. 模型切换必须保持会话诚实

每个运行 Session 记录非敏感兼容事实，至少包括 Agent loop 版本、Adapter 类型、协议能力、
模型身份和相关 runtime fingerprint。只有兼容函数明确允许时才能恢复供应商原生 Session。

不兼容切换时：

- CCLink Thread 和可见消息保留；
- 运行中的任务默认等待安全点，不静默中止；
- 新一轮使用有界连续性快照，而不是把旧供应商 Session ID 交给新服务；
- UI 明确显示上下文从新模型继续，诊断记录切换原因但不记录凭证。

### 6. OSS 与官方边界不变

OSS 可以保存用户主动配置的第三方模型凭证并直接连接用户选择的模型服务，但不提供
CCLink 官方模型账号、订阅、额度、代理转发或生产 API。官方模型服务若未来存在，只能通过
官方集成层接入，不能回流为 OSS 默认依赖。

## 不变量

1. 主进程 Agent Runtime 是 run/session、工具循环、权限和诊断的唯一运行事实源。
2. 模型 Adapter 不能成为第二 Agent Runtime，也不能直接拥有业务工具副作用。
3. 更换模型服务不能更换 Thread 产品模型或绕过 workspace/scope 与人工确认。
4. 凭证只由统一 `CredentialService` 管理，不进入安装包、工作空间、普通设置、renderer
   全量状态或诊断。
5. Agent 或模型服务故障只导致 Agent 能力降级，不阻断其他工作台能力。
6. 能力支持以真实探测和适配测试为准，不以供应商名称或兼容标签推断。
7. 未通过真人端到端验收时，不得把 contract、mock、单元测试或 HTTP 连通性包装成产品
   多模型进度。

## 备选方案

- **支持 ACP 和用户自带 Agent**：拒绝。它解决的是 Agent 框架选择，不是当前用户的模型
  服务选择；同时扩大本地进程信任、会话、权限、安装、认证和支持矩阵。
- **每个模型供应商接入其完整 Agent SDK**：拒绝作为默认模式。多个 SDK 会分别拥有工具
  loop、Session 和错误语义，形成多个运行事实源。只有能被约束为模型传输 Adapter 的部分
  才可采用。
- **永久只支持 Claude Code**：保留为稳定降级，但不作为长期产品边界。它无法证明用户可
  选择模型服务，也让 CCLink Agent 能力持续受单一外部 Agent Runtime 约束。
- **把普通 HTTP Chat 当作完整 Agent**：拒绝。没有结构化工具循环、权限、取消、上下文和
  诊断闭环的 Chat 只能作为独立轻量能力，不能复用完整 Agent 名称。
- **对所有 OpenAI-compatible 端点做无差别适配**：拒绝。兼容标签不能证明 tool calling、
  streaming、多模态、usage 和取消语义一致。

## 风险与影响

- 自有 Agent loop 会把上下文裁剪、工具往返、错误恢复和供应商差异转移到 CCLink，工程
  责任明显高于继续完全依赖 Claude Code。
- 不支持 ACP 会失去一部分希望复用自有 Agent 配置的高级用户，但该人群不是当前产品目标，
  也没有足够证据证明其价值高于新增支持成本。
- 当前 `BackendType`、`apiFormat` 和部分文档保留了 HTTP backend 的历史形状，容易让人误判
  能力已经存在；迁移必须先固定事实，再清理死字段，不能用类型改名冒充功能完成。
- 不同模型可能产生明显不同的工具选择质量。统一协议只能统一边界，不能保证行为质量；
  发布矩阵必须包含真实工具任务而不是只测文本问答。
- Claude Code 与未来自有 loop 在过渡期会并存。必须明确哪个 owner 负责会话与工具，不得把
  两套事件流同时写入同一 run。

## 迁移计划

1. 固定当前事实：Claude Code 是唯一完整工具 Agent；更新产品文档并明确 ACP/BYO Agent
   非目标，不修改当前稳定运行路径。
2. 先定义一个用户可验收的非 Claude 模型纵向任务和能力矩阵，再设计最小
   `ModelServiceAdapter` contract。
3. 在主进程 Agent 领域实现单一 Agent loop 的最小闭环，只接一个额外模型协议，复用现有
   MCP、权限、Thread、取消和诊断，不先建设多 Provider Registry。
4. 完成真实应用中的发送、工具调用、确认、取消、切换、恢复和故障降级验收后，再增加第二
   个 Adapter，以证明抽象不是首个供应商的改名。
5. Claude Code 路径继续作为稳定兼容和回滚入口。只有新 loop 达到同等用户验收与门禁，才
   评估默认值变化；默认值变化需要单独产品决策。
6. 最后清理不再使用的 `backendType`、旧 HTTP Chat 暗示和重复 Provider 分支；持久化字段按
   双读、单写新格式迁移，不能破坏旧设置。

## 回收或复审条件

出现以下任一情况时复审本 ADR：

- 目标用户持续提出“复用自有 Agent”需求，并有无法通过模型 Adapter 满足的真实任务证据；
- 企业部署要求使用受管理、可审计且具有进程隔离契约的外部 Agent；
- ACP 或其他协议同时提供可验证的沙箱、权限强制和 CCLink 工具边界，而不只是消息互通；
- 自有 Agent loop 的真实维护成本持续高于单一外部 Runtime，且用户模型选择目标仍无法达成；
- 官方集成层需要受控远程 Agent，但该需求不得自动改变 OSS 默认路径。

复审不等于自动支持 ACP；仍需重新定义用户验收、信任边界、状态所有者、生命周期、权限、
诊断、降级和发布矩阵。

## 验证

- 文档明确区分当前 Claude Code 主线、目标 Model Adapter 和 ACP/BYO Agent 非目标。
- 首个额外模型 Adapter 必须通过本 ADR“用户目标与端到端验收”的全部真实应用动作。
- Provider 能力缺失、认证失败、网络失败、工具参数错误、取消竞态和模型切换均有结构化失败
  与独立降级测试。
- 同一 run 只有一个 Agent loop 和一个状态所有者，renderer 恢复快照不能覆盖主进程事实。
- 凭证、模型原始敏感响应和供应商 Session ID 不进入诊断或普通持久化。
- `pnpm verify`、受影响 smoke、干净 worktree 和真人验收通过后，才能声明对应模型服务可交付。

## 拷问

- 我们说“Agent 框架自己提供”，究竟是拥有 UI 和工具，还是也拥有模型到工具结果的完整
  loop？当前答案仍包含 Claude Code，不能提前宣布已经解耦。
- 用户要的是更多模型选择，还是更多 Agent 行为？没有后者的证据，就不应让 ACP 扩大路线。
- Provider 返回了文字，不代表它支持工具 Agent；真实门槛是多轮工具、取消、权限、上下文和
  失败恢复是否一致。
- 协议统一不等于模型质量统一。某模型频繁选错工具时，产品如何诊断和降级？
- 最危险的迁移不是新 Adapter 请求失败，而是 Claude Code loop 与自有 loop 同时拥有同一
  Thread，造成重复工具调用或伪恢复。
