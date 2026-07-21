# S3 生命周期与契约治理记录

> 状态：进行中。S3.1、S3.2a、S3.2b1、S3.2b2、S3.2b3 已关闭；下一工作包为 S3.2b4。

## 结论

S3.1 先关闭运行时生命周期的双清单问题：同一个 `ServiceRegistry` 声明启动与停止，保存在 runtime 中，并负责启动失败回滚、窗口重建和最终退出。随后 S3.2a 已删除 IPC 人工清理总表，S3.2b 正分域把注册、preload 调用和运行时校验迁移到共享 contract；Agent、Browser 与项目切换资源解绑完成前，不得宣称 S3 完成。

## 基线问题

| 问题 | 失败表现 | 根因 | S3 工作包 |
| --- | --- | --- | --- |
| 启动与退出使用两份服务清单 | 新服务容易只启动不释放，失败后残留子进程或 listener | `bootstrap-runtime.ts` 和 `shutdown-runtime.ts` 分别手工声明 | S3.1 |
| 启动中断不回滚 | 后续阶段失败时，已创建窗口和主进程服务继续存活 | registry 只记录注册顺序，不记录已启动阶段 | S3.1 |
| macOS activate 只重建窗口 | 全量 IPC 被清除，但主服务、自动化和 Agent IPC 没有重新注册 | 入口直接调用 `cleanupIpcHandlers()` 和 `createWindowRuntime()` | S3.1 |
| IPC 清理依赖手工通道数组 | 新增或改名通道后可能重复注册或无法清理 | 注册、preload、schema、清理没有单一声明源 | S3.2 |
| 项目切换资源归属分散 | 旧 Browser view、任务、Terminal 或会话可能跨项目残留 | workspace transition 尚未统一拥有资源解绑 | S3.3 |

## S3.1 生命周期声明

启动顺序是依赖顺序，停止和失败回滚严格逆序执行。失败阶段在调用 `start` 前即进入 started 集合，因此其部分初始化资源也会执行配对 `stop`。

| 阶段 | 启动责任 | 停止责任 |
| --- | --- | --- |
| `ipc-runtime` | 建立生命周期锚点 | 所有服务停止后清理 IPC handler/listener |
| `state-services` | Settings、WorkspaceState 加载 | flush WorkspaceState 并释放引用 |
| `window-runtime` | 主窗口、可信 sender、Browser/Android 窗口能力 | 认证子进程、Browser views、设备连接、窗口 |
| `main-process-services` | 本地身份、文件、设置、可选主服务和 IPC | 权限确认、Terminal sessions、主服务引用 |
| `automation-runtime` | Editor、Playwright、MCP、设备工具 | Editor、设备工具、MCP、Playwright |
| `agent-runtime` | 本地 Agent bridge | Agent runtime 和子进程 |

## S3.1 验收

- [x] runtime 只持有一个 `ServiceRegistry`，退出路径不再构造第二份清单。
- [x] 服务按注册顺序启动，按逆序停止；重复 start/stop 幂等。
- [x] 任一启动阶段抛错时，失败阶段与此前阶段均逆序回滚。
- [x] 窗口重建通过同一 registry 完整 stop/start，不再手工清 IPC 后只重建窗口。
- [x] 单个资源释放失败不阻断后续释放。
- [x] 单元测试覆盖顺序、失败回滚、并发幂等和完整重建。
- [x] 当前工作树通过 `pnpm verify`、`pnpm smoke:standalone`、严格认证 smoke。
- [x] 全新 detached worktree 通过锁定安装和相同门禁。
- [x] 远端 CI 通过。

## S3.2 IPC 契约

S3.2a 已将生产 renderer IPC 的实际注册和释放收敛到窗口级 `TrustedIpcRegistrationScope`：handler/listener 注册时立即生成精确 disposer，窗口阶段停止时逆序释放；重复 handler 会在同一 scope 内失败，重复 dispose 幂等。原有 `ipc-cleanup.ts` 人工通道数组已删除，listener 不再通过 `removeAllListeners` 误删其他所有者。

S3.2b 继续把 main/preload 的通道名和运行时 schema 收敛到共享 contract。S3.2b1 已建立共享 invoke contract：shared 声明 channel、参数和结果类型，main registrar 在调用 handler 前自动解析，preload client 从同一声明调用。首批 Window、Identity、Official 无参数高权限通道已迁移，并由源码边界测试禁止退回 main/preload 双写字符串。

S3.2b2 已迁移 Settings 与 Dialog。带参数 contract 分为轻量 `IpcInvokeDefinition` 和主进程 `IpcInvokeContract`：前者是 channel/参数/结果的唯一声明源，可安全进入 sandbox preload；后者从同一声明绑定 Zod parser 与可选的结构化解析失败结果。该拆分避免 preload 加载 Node 不可用的外部运行时依赖，同时保留 Settings 原有的 Promise 与错误返回语义。

S3.2b3 已迁移 FS 的 24 个 invoke 通道和目录监听事件。参数上限、严格对象校验、非法路径拒绝和 watcher 生命周期语义保持不变；shared 轻量 definition、主进程 parser binding 与 preload client 分层，防止 Zod 进入 sandbox preload。源码边界测试禁止 FS 通道退回 main/preload 双写，并校验每个轻量 definition 都存在有界 runtime parser。

下一批需迁移 Agent 与 Browser contract；完成前，其他通道字符串仍可能在调用端漂移，S3.2 和整个 S3 都不能关闭。

S3.3 再处理项目切换时 Browser view、BrowserTask、Agent conversation 和 Terminal session 的统一解绑及集成测试。

### S3.2a 验收

- [x] 生产 renderer IPC 不存在 guard 之外的裸 `ipcMain.handle/on`。
- [x] 每次 handler/listener 注册同时生成精确 disposer。
- [x] dispose 幂等，单项清理失败不阻断其他通道。
- [x] 删除人工维护的 IPC 清理通道数组。
- [x] 单元测试覆盖 handler、listener、重复注册和重复清理。
- [x] 当前工作树、干净 worktree 和远端 CI 门禁通过。

首次严格认证复验捕获到 clean Google 已到 identifier URL 但 20 秒内仍为 `pending`，门禁立即失败。检查发现 smoke 虽声明 clean 最多三次，却只对 `network-unavailable` 重试；现将 `pending` 纳入同样的有限重试，但最终通过条件仍严格要求 `account-validation-reached`，不会把超时或外部失败降级为成功。

后续复验确认固定测试邮箱连续查询时可三次均停在 identifier，而独立对照仍完成账号校验。为避免固定不存在账号触发 Google 缓存或节流，每个认证子进程改用唯一的 `example.com` 测试邮箱；成功条件保持不变。

S3.2a 提交为 `d81c21b`，认证门禁修复为 `bd841a8`。当前工作树和全新 detached worktree `/tmp/cclink-studio-s3-ipc-verify.6aEmjj` 均通过 139 个测试文件/828 项测试、standalone 24/24 与严格认证 smoke；detached HEAD 和工作树干净。GitHub Actions run `29805001919` 在 `bd841a8` 完成且结论为 `success`。S3.2a 已关闭，S3.2b 继续。

### S3.2b1 验收

- [x] shared contract 同时声明 channel、参数 parser 和结果类型。
- [x] main 注册器自动执行 contract parser，preload 从同一 contract invoke。
- [x] Window、Identity、Official 不再在 main/preload 保存通道字符串。
- [x] 测试覆盖 parser 边界、main 自动解析和已迁移 namespace 防回退。
- [x] 当前工作树完整门禁通过并形成独立提交。

当前工作树 `pnpm verify` 通过 140 个测试文件/832 项测试，standalone 24/24 与严格认证 smoke 通过。S3.2b1 仍需在提交后完成 detached 和远端 CI 复验，且不代表其他 IPC 域已经迁移。

S3.2b1 实现提交为 `1eb10c1`，认证探针稳定化提交为 `995f747`。全新 detached worktree `/tmp/cclink-studio-s3-contract-verify.3PsEAj` 从 `995f747` 完成锁定安装并通过相同门禁，HEAD 和工作树干净；GitHub Actions run `29805753076` 成功。S3.2b1 已关闭，下一批迁移带参数 contract。

### S3.2b2 验收

- [x] Settings 与 Dialog 的 channel、参数和结果类型只在 shared 轻量定义中声明一次。
- [x] main 从同一轻量定义绑定运行时 parser，并在调用 handler 前完成校验。
- [x] Settings 非法参数继续返回结构化 Promise 失败，不进入持久化；业务 handler 异常不会被误映射为参数错误。
- [x] Dialog 可选参数、边界限制和窗口销毁降级语义保持不变。
- [x] preload 不导入 Zod、Settings/Dialog schema 或主进程 runtime contract。
- [x] 源码边界测试禁止迁移域退回 main/preload 双写 channel，并禁止 preload 引入 runtime schema。
- [x] 当前工作树、全新 detached worktree 和远端 CI 门禁通过。

首次 standalone 复验发现 renderer preload 未暴露 `window.cclinkStudio`，local smoke 失败 8/9。根因是最初把 Zod parser 与 preload 客户端定义放在同一模块，sandbox preload 产物因此产生 `require("zod")`。修复后轻量 definition 与 runtime parser binding 分层，preload 产物由 31.60 kB 回落到 26.62 kB 且不再外部加载 Zod；对应源码边界测试防止回退。

S3.2b2 实现提交为 `bcaadc9`。当前工作树与全新 detached worktree `/tmp/cclink-studio-s3-contract2-verify.ejGI7y` 均通过 `pnpm verify`（140 个测试文件/836 项测试）、standalone 24/24 与严格认证 smoke，detached HEAD 和工作树干净；GitHub Actions run `29807348621` 的 `verify` 与 `smoke` job 均成功。S3.2b2 已关闭，下一批迁移 FS、Agent 与 Browser contract。

### S3.2b3 验收

- [x] FS 的 24 个 invoke channel、参数与结果类型只在 shared 轻量 definition 中声明一次。
- [x] 目录监听事件名和 payload 类型由 main/preload 共享，停止监听只移除本次注册的精确 listener。
- [x] main 从同一轻量 definition 绑定运行时 parser，并在 FileService 或 Electron shell 调用前拒绝非法参数。
- [x] 原有路径、文本、图片、Markdown 操作和 watch ID 边界保持不变，既有 schema import 通过兼容 re-export 保留。
- [x] preload 不导入 Zod、FS schema 或主进程 runtime contract，生产 preload 产物不包含 `require("zod")`。
- [x] 测试覆盖 definition/parser 完整对应、参数个数、NUL 路径、watch UUID 和非法参数不进入 FileService。
- [x] 当前工作树、全新 detached worktree 和远端 CI 门禁通过。

S3.2b3 实现提交为 `34af454`。当前工作树与全新 detached worktree `/tmp/cclink-studio-s3-fs-contract-verify.XhPvTp` 均完成 `pnpm install --frozen-lockfile` 后通过 `pnpm verify`（140 个测试文件/838 项测试）、standalone 24/24 与严格认证 smoke；Profile Cookie/localStorage 跨进程保持成功，clean 与 automation-controlled 探针到达 Google account validation。detached HEAD 和工作树干净，临时 worktree 已清理。GitHub Actions run `29808826150` 的 `verify` 与 `smoke` job 均成功。S3.2b3 已关闭，下一批迁移 Agent 与 Browser contract。

## 当前门禁证据

2026-07-21 当前工作树：

- `pnpm verify`：139 个测试文件、826 项测试通过，OSS boundary、format、lint、typecheck 和生产构建返回 0。
- `pnpm smoke:standalone`：local 9/9、UI 6/6、workflow 5/5、restore 4/4。
- `CCLINK_AUTH_SMOKE_REQUIRE_GOOGLE=1 pnpm smoke:auth-window`：Profile Cookie/localStorage 跨进程持久化通过；干净认证进程到达 Google account validation，CDP 对照被识别为不安全浏览器。

提交 `3030828` 的全新 detached worktree `/tmp/cclink-studio-s3-verify.7gwcNm` 完成 `pnpm install --frozen-lockfile` 后通过相同三组门禁，HEAD 与工作树均干净。GitHub Actions push run `29804363879` 在同一提交上完成且结论为 `success`。

2026-07-21 S3.2b2 最新证据：实现提交 `bcaadc9` 在当前工作树和全新 detached worktree 均通过 140 个测试文件/836 项测试、standalone 24/24 与严格认证 smoke；远端 CI run `29807348621` 成功。下一阻断项仍是 FS、Agent、Browser contract 和 S3.3 项目切换资源解绑。

2026-07-21 S3.2b3 最新证据：实现提交 `34af454` 在当前工作树和全新 detached worktree 均通过 140 个测试文件/838 项测试、standalone 24/24、严格认证 smoke 和 preload 无 Zod 产物检查；远端 CI run `29808826150` 成功。下一阻断项为 Agent、Browser contract 和 S3.3 项目切换资源解绑。

## 拷问

- registry 统一不等于资源已经全部可释放；没有 disposer 的服务必须补契约，不能只把字段设为 `null`。
- 重建测试不能只断言窗口出现，还要证明 Agent、Terminal、Browser IPC 均重新注册且不存在 duplicate handler。
- 项目切换不能借用全应用重启掩盖状态所有权问题；旧资源必须按 workspace ID 明确解绑。
- shared contract 可复用不代表所有实现都适合进入 preload；任何 parser 依赖都必须留在主进程绑定层，preload 只加载轻量 definition。
