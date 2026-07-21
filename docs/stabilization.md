# CCLink Studio 稳定化阶段

> 状态：S0、S1、S2、S3 已完成，S4 待推进，稳定化阶段继续。开始日期：2026-07-20。S0 完成日期：2026-07-20。S1、S2、S3 完成日期：2026-07-21。

## 结论

当前暂停扩大功能面。开发资源优先用于恢复质量门禁、关闭安全缺口、拆除跨能力硬依赖、统一生命周期和 IPC 契约，直到满足本文退出标准。

稳定化不是停止产品开发，而是把已经确定的浏览器、Agent、Terminal、编辑器、工作区和运营流程变成可长期维护的基座。

## 允许进入的改动

- P0/P1 安全、数据丢失、崩溃、登录状态、任务状态和项目切换问题。
- 恢复 `pnpm verify`、构建、测试和 smoke 的修复。
- 为独立降级、生命周期、IPC contract、诊断和密钥隔离服务的架构调整。
- 修复上述问题所必需的测试、文档和小范围重构。

新增业务功能默认延期。确需进入时，必须证明它直接解除稳定化阻塞、不扩大权限面、不增加新的跨模块依赖，并在 PR 中说明退出或回收条件。

## 当前基线

2026-07-20 S0 关闭结果：

- 稳定化分支为 `codex/stabilization-s0`，S0 功能基线为 `b0061b8`。`49da3b2` 继续按 `docs/decisions/0001-preserve-stabilization-snapshot.md` 保留为不可改写的原始现场快照。
- S0 收口提交覆盖格式与 OSS 边界、旧账号迁移隔离、standalone/auth smoke、workflow 清理生命周期、干净安装 Electron runtime、UI 首屏等待、CI 确定性认证门禁、Terminal 应用内 URL 接管和文件树 watcher 监听器清理。
- `pnpm verify` 已通过：OSS 边界、格式、lint、108 个测试文件/720 项测试、typecheck 和生产构建全部返回 0。
- `pnpm smoke:standalone` 已通过：local 9/9、UI 5/5、workflow 5/5、restore 4/4。
- 严格模式 `CCLINK_AUTH_SMOKE_REQUIRE_GOOGLE=1 pnpm smoke:auth-window` 已通过：Profile 的 local storage 与 Cookie 跨 Electron 重启保留，纯净窗口到达 Google 账号校验页；启用 CDP 的对照窗口被 Google 判为不安全。
- 从 `b0061b8` 创建的全新 detached worktree 已依次通过 `pnpm install --frozen-lockfile`、`pnpm verify`、`pnpm smoke:standalone` 和严格模式 `smoke:auth-window`，`git status --short` 为空。
- GitHub push CI `29747137749` 与 PR CI `29747140609` 均通过；CI 只执行确定性的 Profile/窗口认证门禁，严格 Google 联网验证保留在本地候选与真人验收。
- H1-H5 真人验收全部通过，证据位于 `docs/ops/stabilization-s0-acceptance.md`。
- S0 已关闭，但稳定化阶段并未结束；下一轮进入 S1 安全边界，不恢复无约束的功能扩张。

2026-07-21 S1 关闭结果：

- 稳定化分支为 `codex/stabilization-s1`，S1 验证基线为 `43dc9ac`；完整安全边界、失败路径和分阶段证据位于 `docs/ops/stabilization-s1-security-inventory.md`。
- S1 隔离不可信 HTML 并启用 renderer sandbox/CSP，将 Agent 与 Meshy 密钥迁移到 `safeStorage`，为所有 renderer IPC 接入 trusted sender guard 和有界运行时 schema，收紧 Browser 本地文件、更新源与官方集成边界，并将 preload 总入口缩减到 179 行。
- `pnpm verify` 已通过：OSS 边界、格式、lint、132 个测试文件/803 项测试、typecheck 和生产构建全部返回 0。
- `pnpm smoke:standalone` 已通过：local 9/9、UI 6/6、workflow 5/5、restore 4/4；严格 Google 联网 `smoke:auth-window` 已验证 Profile 持久化、纯净窗口到达账号校验页以及 CDP 对照被拒绝。
- 从 `43dc9ac` 创建的全新 detached worktree 已完成锁定安装并通过相同门禁，工作树保持干净。首次 detached smoke 捕获的 WorkspaceState JSON 归一化回归已在 `43dc9ac` 修复并补测试。
- GitHub Actions run `29795361173` 已绑定 `43dc9ac`，`verify` 与独立 `smoke` job 全部成功；CI 的认证检查保持为确定性 Profile/窗口机制，不依赖 Google 外部网络。
- S1 已关闭，但稳定化阶段继续进入 S2 能力独立降级；IPC 单一声明源与清理生命周期仍按计划保留给 S3，不因 S1 绿色而忽略。

每完成一个工作包都必须更新本节；不得用后续功能掩盖尚未恢复的基线。

## 工作包

### S0：恢复可信基线（已完成）

S0 的目标是得到一个干净、可归因、可以从零复现的绿色基线。S0 只恢复可信施工面，不以测试绿色代替 S1-S4 的安全和架构治理。

#### S0.1：冻结与保全现场

- 在不执行 `reset`、`checkout --` 或丢弃未跟踪文件的前提下，将当前现场迁移到稳定化分支。
- 记录基线 HEAD、文件状态、差异规模、门禁结果和领域归属。
- 暂停新增业务功能；稳定化期间只接受本文“允许进入的改动”。

验收证据：

- 稳定化分支存在，原始改动完整保留。
- `docs/ops/stabilization-s0-inventory.md` 可以解释所有改动属于哪个领域，哪些文件是跨域集成点。
- 不存在来源和目的均无法说明的未跟踪文件。

#### S0.2：按领域收敛改动

- 架构治理、浏览器登录、Markdown/文件、Agent 会话、UI 基础设施、开发构建分别形成可审计工作包。
- 每个工作包说明目标、权限变化、状态所有者、生命周期、测试和回滚边界。
- `App.tsx`、`preload/index.ts`、`main/index.ts`、全局 CSS 等跨域文件最后集成，不能被某个功能包顺手占有。

验收证据：

- 每个提交只承担一个明确目标并可独立回滚。
- 提交不依赖尚未纳入同一工作包的未跟踪文件。
- 没有通过批量格式化掩盖行为改动。
- 已共享的现场快照若不能安全改写，必须有 accepted ADR、完整库存和只覆盖该快照的例外边界。

#### S0.3：恢复质量门禁

- 处理 5 个格式失败文件，但只在所属工作包行为稳定后局部格式化。
- 旧账号文件兼容必须收敛到显式 migration 边界：允许列表只覆盖迁移模块和迁移测试，业务代码、普通测试和当前产品文档不得继续出现旧产品名。
- 禁止删除有效测试、降低断言、拆分字符串绕过扫描或全局放宽边界规则。

验收命令：

```bash
pnpm verify:oss-boundary
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify
git diff --check
```

以上命令必须全部返回 0。

#### S0.4：干净环境复现

- 从候选提交创建新的干净 worktree。
- 使用锁文件安装依赖，不读取当前工作树的未跟踪源码或构建产物。
- 在干净 worktree 运行完整无 GUI 门禁和 Electron 冒烟。

验收命令：

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm smoke:standalone
CCLINK_AUTH_SMOKE_REQUIRE_GOOGLE=1 pnpm smoke:auth-window
```

候选分支本机和干净 worktree 必须执行严格 Google 联网检查。GitHub CI 必须执行 `pnpm verify`、`pnpm smoke:standalone` 和 `CCLINK_AUTH_SMOKE_PROFILE_ONLY=1 pnpm smoke:auth-window`，只验证确定性的独立窗口、Profile、Cookie 和 localStorage 跨进程持久化，不访问 Google。严格联网结果由本地候选和 H3 真人验收共同保证。

#### S0.5：核心流程人工验收

- 启动应用并打开本地项目。
- 编辑 Markdown、保存图片并验证重启恢复。
- 新建 Terminal，验证 PTY、cwd 和应用内网页打开。
- 验证普通浏览器、独立登录窗口、Profile 登录状态与应用回接。
- 切换项目，确认浏览器、会话和 Terminal 不串项目。
- 缺少可选能力时，应用正常启动并显示明确降级状态。

人工验收必须记录版本、步骤、结果和诊断日志位置；失败项必须转成可复现用例。
当前记录位于 `docs/ops/stabilization-s0-acceptance.md`。

#### S0 退出条件

- 工作树干净，没有未知未跟踪文件。
- 改动按领域形成可审计提交，跨域集成点有明确说明。
- `pnpm verify` 在本机、干净 worktree 和 CI 全部通过。
- 候选分支本机与干净 worktree 的 `pnpm smoke:standalone`、严格模式 `smoke:auth-window` 通过；CI 的确定性 auth-window 门禁通过。
- 核心流程人工验收完成并留有记录。
- 本文“当前基线”更新为真实结果。

S0 绿色只表示恢复可信基线。Markdown 注入、明文密钥、Agent 与浏览器硬依赖、IPC 生命周期和状态所有权仍分别由 S1-S4 负责。

### S1：封闭安全边界（已完成）

- 隔离或严格清洗所有进入主 renderer 的 HTML、Markdown、SVG 和网页内容。
- 为主 renderer 增加 CSP，评估并启用 sandbox；缩小 preload API。
- 为高权限 IPC 增加 sender、schema、工作区路径和资源作用域校验。
- 将 API Key、Meshy Key 等密钥迁移到 `safeStorage`，renderer 不再读取明文。
- 增加恶意文档、路径越界和密钥泄露回归测试。

完成结果：S1.1-S1.4b 已通过当前工作树、全新 detached worktree 和远端 CI 门禁，库存、失败边界和证据见 `docs/ops/stabilization-s1-security-inventory.md`。S1.1 隔离不可信 HTML 并启用 renderer sandbox；S1.2 将 Agent/Meshy 密钥迁移到 `safeStorage`；S1.3 建立主 renderer CSP 和首批 trusted sender guard；S1.4a 覆盖 Browser、Android 与数据源并撤销高风险旧入口；S1.4b 将 guard 与有界 schema 扩展到所有剩余 renderer IPC，限制 Browser 本地 HTML 到真实工作区资源，收紧更新源和官方集成 registrar，并把 preload 总入口缩减到 179 行。S1 已关闭，但不得据此恢复功能扩张；下一轮按计划进入 S2。

### S2：能力独立降级

- Agent 核心不再要求 Playwright、Android 或任意可选工具模块必须启动成功。
- 每个模块独立初始化并返回结构化能力状态。
- 浏览器、设备或插件失败时，本地文件、编辑器和 Terminal Agent 仍可工作。
- UI 和诊断日志显示真实降级原因及恢复入口。

完成结果：S2.1-S2.3 已在实现基线 `b7c1854` 完成，关闭门禁在 `1d80425` 收敛。自动化模块、可选主进程服务以及 Browser/Android 窗口构造均拥有独立失败边界；首个失败原因进入四态能力状态、设置页和脱敏诊断，核心工作台与无关能力在故障注入后继续启动。当前工作树和全新 detached worktree 的 `pnpm verify` 均通过 138 个测试文件/821 项测试，standalone 24/24 与严格认证 smoke 通过，GitHub Actions run `29800851580` 成功。关闭复验曾发现 standalone 共用全局 PID、日志、端口和 Profile 会误连已删除 worktree 的残留 renderer，现已改为 worktree/CI 独立 smoke runtime；详细证据见 `docs/ops/stabilization-s2-capability-matrix.md`。S2 已关闭，但设置页刷新只读取真实状态，环境修复后的当前恢复入口仍是重启 Studio；进程内重试、统一回滚、窗口重建和停止属于 S3。稳定化阶段继续，不恢复功能扩张。

### S3：统一生命周期和契约（已完成）

- 使用同一服务注册表负责启动、回滚、窗口重建和停止。
- IPC 从共享声明生成注册、preload 调用、运行时校验和清理逻辑。
- 清除重复 listener、遗留子进程、跨项目视图和失效任务。
- 为启动中断、窗口重建、项目切换和退出增加集成测试。

S3.1 从 S2 最终提交 `8418572` 建立 `codex/stabilization-s3`，实现基线为 `3030828`。唯一 `ServiceRegistry` 现保存到 runtime，同一组声明负责正序启动、失败阶段及此前阶段的逆序回滚、整套窗口重建和幂等停止；原先退出时临时构造的第二份清单以及 activate 时“清空全部 IPC 后只重建窗口”的路径已删除。该阶段当前工作树与全新 detached worktree 均通过 139 个测试文件/826 项测试、standalone 24/24 和严格认证 smoke，GitHub Actions run `29804363879` 成功。后续 S3.2、S3.3 的关闭结果见下文，完整库存和验收见 `docs/ops/stabilization-s3-lifecycle-inventory.md`。

S3.2a 已关闭：所有生产 renderer IPC 注册均已确认收敛到 trusted guard；窗口级 registration scope 现在从实际 `handle/on` 注册生成精确 disposer，替代并删除人工维护的 `ipc-cleanup.ts` 通道数组。当前工作树与全新 detached worktree 均通过 139 个测试文件/828 项测试、standalone 24/24 和严格认证 smoke，GitHub Actions run `29805001919` 成功。main/preload 通道名和运行时 schema 同源仍属于 S3.2b，不能因清理列表删除而宣称 IPC 契约治理完成。

S3.2b1 已关闭：shared `IpcInvokeContract` 已建立，main 注册器自动执行参数 parser，preload client 使用同一 channel/result contract；Window、Identity、Official 为首批迁移域。当前工作树与全新 detached worktree 均通过 140 个测试文件/832 项测试、standalone 24/24 和严格认证 smoke，GitHub Actions run `29805753076` 成功。带参数的高权限 Settings、Dialog、FS、Agent 与 Browser 仍待后续批次迁移，S3.2 尚未关闭。

S3.2b2 已关闭：Settings 与 Dialog 已迁移到 shared 轻量 invoke definition，并在主进程从同一声明绑定运行时 schema；Settings 的结构化失败语义和 Dialog 的可选参数语义保持不变。standalone 首次复验发现 sandbox preload 不能加载外部 Zod，现已通过 definition/parser 分层修复并补防回退测试，preload 不再携带 runtime schema。实现提交 `bcaadc9` 在当前工作树与全新 detached worktree 均通过 140 个测试文件/836 项测试、standalone 24/24 和严格认证 smoke，GitHub Actions run `29807348621` 成功。FS、Agent、Browser contract 与 S3.3 项目切换资源解绑仍未完成，因此 S3 和稳定化阶段均保持进行中。

S3.2b3 已关闭：FS 的 24 个 invoke 通道和目录监听事件已迁移到 shared 轻量 definition，主进程从同一声明绑定有界 parser，preload client 不再保存重复通道字符串或加载 runtime schema。路径、文本、图片、Markdown 操作和 watcher 生命周期语义保持不变，源码边界与非法参数测试防止回退。实现提交 `34af454` 在当前工作树与全新 detached worktree 均通过 140 个测试文件/838 项测试、standalone 24/24、严格认证 smoke 和 preload 无 Zod 产物检查，GitHub Actions run `29808826150` 的 `verify` 与 `smoke` job 均成功。Agent、Browser contract 与 S3.3 项目切换资源解绑仍未完成，因此 S3 和稳定化阶段继续进行。

S3.2b4 已关闭：Agent 的 16 个 invoke 通道、MCP 的 5 个 invoke 通道和 4 个 renderer 事件已迁移到 shared 轻量 definition，主进程从同一声明绑定有界 parser，preload client 不再保存重复通道字符串或加载 runtime schema。消息发送和 scope 重载、异步参数拒绝以及 MCP 结构化失败语义保持不变，源码边界与 parser 完整性测试防止回退。实现提交 `8a27c90` 在当前工作树与全新 detached worktree 均通过 140 个测试文件/839 项测试、standalone 24/24、严格认证 smoke 和 preload 无 Zod 产物检查，GitHub Actions run `29810751046` 成功。Browser contract 与 S3.3 项目切换资源解绑仍未完成，因此 S3 和稳定化阶段继续进行。

S3.2b5 已关闭：Browser、BrowserTask 和 BrowserDownload 的 42 个 invoke 通道及 8 个 renderer 事件已迁移到 shared 轻量 definition，主进程从同一声明绑定有界 parser，preload client 与事件生产点不再保存重复通道字符串或加载 runtime schema。URL、Profile、bounds、缩放、任务和下载参数边界保持不变，解析失败继续以 Promise rejection 返回。实现提交 `dee51b6` 在当前工作树与全新 detached worktree 均通过 140 个测试文件/840 项测试、standalone 24/24、严格认证 smoke 和 preload 无 Zod 产物检查，GitHub Actions run `29812695777` 成功。至此 S3.2 已关闭；S3.3 项目切换资源解绑仍未完成，因此 S3 和稳定化阶段继续进行。

S3.3 与 S3 已关闭：项目切换 transition 现显式盘点 Browser view、BrowserTask、Agent conversation 和 Terminal session 的 workspace 所有权，在 hydrate 目标现场前先把 Browser runtime 绑定到目标 workspace 并隐藏旧视图。后台 BrowserTask、Agent run 和 PTY 不因切换被终止，返回原项目后继续恢复；目标项目只显示自己的 Tab、活跃会话和 Terminal，并且 Agent/Terminal 人工确认请求按 conversation/workspace 过滤。Browser 可选能力无法 reconcile 时记录错误并允许工作区继续切换，不破坏 S2 独立降级。实现提交 `57f1ed2` 在当前工作树与全新 detached worktree 均通过 141 个测试文件/845 项测试、standalone 24/24 和严格认证 smoke，GitHub Actions run `29814488957` 成功。S3 生命周期与 IPC 契约治理全部完成，下一工作包为 S4 状态与复杂度收敛；在 S4 与最终架构复审完成前仍不得恢复功能扩张。

### S4：收敛状态和复杂度

- 明确 workspace、browser profile、conversation、terminal 和 tab 的唯一状态所有者。
- 把跨 store 项目切换收敛为可测试的 transition/service。
- 按职责拆分超大组件、store 和服务；拆分前先补行为测试。
- 将诊断事件统一到可关联的任务和工作区 ID。

## 退出标准

只有同时满足以下条件，才能恢复常规功能扩张：

- 干净检出下 `pnpm verify` 全部通过。
- `pnpm smoke:standalone` 通过，打包后的核心流程完成一次人工验收。
- 已知 P0/P1 安全与数据完整性问题关闭，并有回归测试。
- Agent、浏览器、Terminal、编辑器和 Android 的独立降级经过自动化验证。
- 密钥不再明文持久化或暴露给 renderer。
- IPC 生命周期与参数校验具有单一声明源，不再依赖人工维护清理清单。
- 登录状态、项目切换、窗口重建和任务状态可从诊断日志明确定位。
- 剩余架构债务有负责人、优先级和明确边界，不阻断上述能力。

退出稳定化阶段必须进行一次架构复审，并更新 `docs/architecture.md`、本文状态和下一阶段范围。
