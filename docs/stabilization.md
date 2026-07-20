# CCLink Studio 稳定化阶段

> 状态：进行中。开始日期：2026-07-20。

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

2026-07-20 检查结果：

- 稳定化分支为 `codex/stabilization-s0`，现场基线提交为 `49da3b2`。该提交包含原始 104 个跨域文件，现场已保全，但仍需按 `docs/ops/stabilization-s0-inventory.md` 收敛可审计边界。
- S0 收口代码已形成独立提交：`a4353ef` 恢复格式门禁、`45d1dcd` 隔离旧账号迁移、`16e13da` 加固 standalone/auth smoke、`2316f7a` 修复 workflow smoke 清理生命周期、`0137fb5` 保证干净安装具备 Electron runtime、`94fbcf7` 稳定 UI 首屏等待。本文档记录提交后工作树干净，不存在未知未跟踪文件。
- `pnpm verify` 已通过：OSS 边界、格式、lint、107 个测试文件/718 项测试、typecheck 和生产构建全部返回 0。
- `pnpm smoke:standalone` 已通过：local 9/9、UI 5/5、workflow 5/5、restore 4/4。
- 严格模式 `CCLINK_AUTH_SMOKE_REQUIRE_GOOGLE=1 pnpm smoke:auth-window` 已通过：Profile 的 local storage 与 Cookie 跨 Electron 重启保留，纯净窗口到达 Google 账号校验页。对照实验中启用 CDP 的窗口被 Google 判为不安全，认证子进程不得挂接 CDP 或 Playwright。
- detached 干净 worktree 已从 `94fbcf7` 复现成功：`pnpm install --frozen-lockfile`、`pnpm verify`、`pnpm smoke:standalone` 和严格模式 `smoke:auth-window` 全部返回 0，且应用由该 worktree 独立启动并完成重启恢复。
- CI 已固定 pnpm 11.5.0 和 frozen lockfile，并拆分 `verify` 与 macOS Electron smoke job；等待分支推送后取得远端结果。
- `49da3b2` 按 `docs/decisions/0001-preserve-stabilization-snapshot.md` 保留为不可改写的现场快照；该例外不适用于任何后续提交。
- GitHub CI 和核心流程人工验收尚未完成，因此 S0 仍为进行中。

每完成一个工作包都必须更新本节；不得用后续功能掩盖尚未恢复的基线。

## 工作包

### S0：恢复可信基线

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

### S1：封闭安全边界

- 隔离或严格清洗所有进入主 renderer 的 HTML、Markdown、SVG 和网页内容。
- 为主 renderer 增加 CSP，评估并启用 sandbox；缩小 preload API。
- 为高权限 IPC 增加 sender、schema、工作区路径和资源作用域校验。
- 将 API Key、Meshy Key 等密钥迁移到 `safeStorage`，renderer 不再读取明文。
- 增加恶意文档、路径越界和密钥泄露回归测试。

### S2：能力独立降级

- Agent 核心不再要求 Playwright、Android 或任意可选工具模块必须启动成功。
- 每个模块独立初始化并返回结构化能力状态。
- 浏览器、设备或插件失败时，本地文件、编辑器和 Terminal Agent 仍可工作。
- UI 和诊断日志显示真实降级原因及恢复入口。

### S3：统一生命周期和契约

- 使用同一服务注册表负责启动、回滚、窗口重建和停止。
- IPC 从共享声明生成注册、preload 调用、运行时校验和清理逻辑。
- 清除重复 listener、遗留子进程、跨项目视图和失效任务。
- 为启动中断、窗口重建、项目切换和退出增加集成测试。

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
