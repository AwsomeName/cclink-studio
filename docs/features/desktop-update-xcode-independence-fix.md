# Desktop Update Xcode Independence Fix

> 状态：`IMPLEMENTED / TARGETED CHECKS PASS / REAL UPDATE PENDING`，2026-10-16。
> 已按独立评审补齐缓存复验分类、坏包重试状态及当前 App 身份分支，完成源码修复和局部验证；
> Git 提交和推送记录以仓库为准；修复尚未发布，故障机真实更新仍待验收。
> 旧版在许可阻塞环境下仍不能安装更新；用户闭环待故障机在不接受协议的情况下真实升级确认。
> 核对基线：v0.1.117，`3a59fdfd6c07ce8341bfd05353a7c22f10f0b2a7`。
> 工程约束以 [架构宪法](../architecture.md#架构宪法) 和
> [ADR 0021](../decisions/0021-verified-dmg-transactional-install.md) 为准。

## 结论

Studio 更新必须独立于用户电脑的 Xcode 安装、初始化和许可状态。最小修复范围是：

1. 用主进程内的有界 Mach-O 文件头检查替换运行时 `lipo` 调用，保留架构限制。
2. 修正校验异常的错误分类，以及前置缓存复验、自动安装和打开安装包的重试、缓存处理。
3. 通过现有诊断链记录实际失败步骤，并修复报告中的 `[object Object]`。

不重做下载、安装事务或回滚机制，不新增更新框架、权限、第三方解析库或第二状态所有者。
首个修复版默认采用一次手工安装完成过渡，之后验证连续应用内升级；不能承诺仅发布新包就让
旧版更新器自动获得修复。

## 用户端到端验收动作

在 Apple Silicon Mac 的两类受控环境中分别验收：未安装 Xcode 或命令行开发工具；已安装
Xcode 但尚未接受当前许可。不要为了构造环境而删除用户现有工具或修改许可记录。

1. 从官方 Release 手工安装一次包含修复的正式签名、公证基线 A，保留原用户数据。
2. 打开已有工作空间、标签和文档，下载下一个正式版本 B。
3. 点击“安装并重启”，按现有提示保存现场、处理运行任务并确认安装。
4. 不操作 Terminal、不接受 Xcode 协议、不手工退出或拖动应用，即可看到 B 的工作台；
   核对版本、工作空间、标签和已保存文档恢复。
5. 通过后续正常正式版本 C 重复一次应用内升级，记录第二轮结果。
6. 单独验证“打开安装包”入口能够在完整校验后交由 Finder 打开 DMG。
7. 注入损坏资产、错误发布者、错误版本、错误架构和校验执行异常：不得安装不可信候选；
   退出前失败时旧版继续运行，UI 和诊断能说明实际失败步骤。

两轮真实升级与失败路径验收记录到 [更新验收记录](../ops/desktop-update-acceptance.md)。
自动测试、Helper 实验或公开 Release 只证明各自工程门禁，不代替这组产品验收。

## 已确认事实和证据边界

### 故障来自另一台电脑

用户提供的截图显示当前 v0.1.114，候选 v0.1.117，错误为 `publisher_mismatch`，文案为
“更新应用未通过 Apple 签名、公证或身份检查”。2026-10-16T05:31:23.816Z 生成的框架报告
只有 `phase=failed error=[object Object]`，没有原始校验命令的 stderr。

同一故障电脑后续执行：

```text
$ /usr/bin/xcode-select -p 2>&1
/Applications/Xcode.app/Contents/Developer

$ /usr/bin/lipo -archs /bin/ls 2>&1
You have not agreed to the Xcode and Apple SDKs license.
```

随后进入 Xcode 许可展示。因此“未安装 Xcode”不是本次证据支持的结论；已配置的开发工具
仍会因未接受许可而阻塞。这是故障机直接证据，不是开发机安装成功的反向推测。

### 修复前代码缺陷

- [MacDmgVerifier](../../src/main/update/mac-dmg-verifier.ts) 在读取候选应用的
  `CFBundleExecutable` 后调用 `/usr/bin/lipo -archs`；DMG 内候选及复制后的候选都会经过它。
- 同一个 `verifyCandidateApp()` 的 catch 把非类型化异常统一转换为 `publisher_mismatch`，
  文案与截图一致，原始异常未保留。当前应用身份与 DMG 校验的 catch 也存在异常泛化。
- [框架诊断报告](../../src/renderer/src/features/diagnostics/framework-diagnostic-report.ts)
  直接插值错误对象，丢失其结构化内容。
- v0.1.114 到 v0.1.117 的上述校验和安装实现没有修改，重复发版没有移除这项运行时依赖。

此前在开发机隔离模拟开发工具不可用，已复现“签名和 Gatekeeper 检查通过，但最终显示相同
`publisher_mismatch`”的路径。该实验只证明异常映射缺陷；故障机后续输出才证明其存在实际
许可阻塞。旧更新日志没有原始 stderr，不能据此断言历史每一次同名错误均只有这个原因；
移除依赖后仍需完成故障机整条升级验收。

## 最小实现边界

### 移除用户端开发工具依赖

在 `src/main/update/` 内提供局部、无副作用的架构检查函数，由 `MacDmgVerifier` 复用：

- 使用 Node 文件 API 只读、有界地读取必要文件头和元数据，不把整个应用二进制读入内存。
- 保留普通文件、非符号链接检查，校验魔数、长度、字节序、CPU 类型及所需子类型；
  文件句柄在成功和失败路径均关闭。
- 保持现有“只有一个受支持的 arm64 架构”的策略。不得把 arm64e 因 CPU 大类相同而放行，
  不得因 Universal 含 arm64 切片就放行；截断、未知或无法安全解释的内容一律拒绝。
- 保留标准 FAT32 和 FAT64 单 arm64 容器，不把“单一 arm64”收紧为“仅 thin 格式”。
  检查索引与切片架构一致、偏移和长度合法、对齐合法；FAT32 额外识别旧 `lipo` 计入的隐藏
  ARM64 条目，防止把隐藏多架构误判为单架构。正常路径最多读取 80 字节文件内容。
- DMG 内候选和复制后的暂存候选使用同一实现，不新增绕过最终复验的安装入口。
- 更新运行时不得再调用 `lipo`、`xcrun`、`xcodebuild` 或其他开发工具；CI 编译、签名和
  公证仍可使用开发工具，不对整个仓库作一刀切禁用。

这不是通用 Mach-O 解析器，不扩展平台或架构，不引入原生模块或第三方库。
文件头结构参考 [Apple mach_header_64](https://developer.apple.com/documentation/kernel/mach_header_64)。
架构名称与 capability mask 对照
[Apple cctools arch.c](https://github.com/apple-oss-distributions/cctools/blob/main/libstuff/arch.c)，
FAT 边界对照 [Apple cctools lipo.c](https://github.com/apple-oss-distributions/cctools/blob/main/misc/lipo.c)。

### 修正错误和缓存处理

复用 [现有更新错误契约](../../src/shared/update/update-contract.ts)，只增加一个
`verification_failed`；不增加 IPC 通道、另一套错误协议或通用任务状态机。

- `publisher_mismatch` 仅用于成功读取候选 DMG 或候选 App 身份后，确认其不符合现有发布者
  或产品身份要求，不能再承接任意命令异常或当前 App 身份不合格。
- 当前 App 身份读取成功但不可信时，使用已有 `install_blocked` 阻断安装，提示先手工安装
  官方基线；这不能证明候选包有问题，必须保留下载及摘要。当前 App 身份读取本身失败仍
  属于 `verification_failed`，不得绕过当前身份检查。
- 无法完成校验的命令、读取或超时异常使用 `verification_failed`。签名或 Gatekeeper 检查
  未通过且不能归因为明确身份比较时，同样安全阻断，并通过步骤和有界诊断说明失败位置，
  不把它武断解释成证书换人或包已损坏。
- 已有的 `download_corrupt`、`release_invalid`、`unsupported_arch` 等明确错误保留语义。
- 用户文案使用稳定的步骤说明；原始系统错误不直接拼进 UI，也不把完整 stderr 跨 IPC 传输。

[UpdateService](../../src/main/update/update-service.ts) 的两条入口都必须调整：

- 前置 `UpdateCache.revalidate()` 同样区分未完成与确认无效。缓存记录或文件的权限、I/O、
  忙碌等读取异常保留缓存并返回 `verification_failed`；缺失文件、畸形记录、记录不一致、
  非普通文件、长度或哈希不匹配才按 `download_corrupt` 作废。启动恢复遇到暂时读取失败时
  也不删除下载。调用方不得再把所有复验异常重写成包损坏或预先清空已验证下载句柄。
- 自动安装的 `invalidAsset` 分类不能把 `verification_failed` 当成已确认坏包。
- 手工入口不能继续用“除了 `install_failed` 外都删缓存”的分支处理新错误。
- `verification_failed` 保留已通过大小和 SHA-256 检查的下载缓存及候选摘要，回到现有可重试
  状态，并展示错误。保留下载不代表签名或安装信任已经成立；重试必须重新执行完整校验。
- 明确候选资产损坏、版本不符、身份不匹配或不支持架构时，继续按现有策略使资产失效。
- 手工入口确认候选无效时，同步清空内部候选句柄和快照中的 `availableRelease`、`progress`，
  再进入 `failed`。对可重试的坏包错误，UI 的“重试”因此重新检查更新，取得新候选后才能
  下载；不得保留已失效摘要，让 UI 调用已无内部候选的下载分支。
- 上述摘要清理只发生在已确认候选无效的分支，不修改通用 `fail()`；普通下载失败继续保留
  有效候选，允许直接重试下载，无需多一次检查更新。
- 两条入口均不得在校验未完成时执行 `openPath`、arm、commit 或 quit；自动安装失败沿用
  既有取消和 guard 释放路径，只清理本次暂存事务，不扩大清理范围。

重试、候选摘要和错误继续由 `UpdateService` 统一拥有。renderer 仅呈现快照，不自行判断包
可信、不推测失败原因，也不保存第二份更新事实。

### 修复有界诊断

错误来源在主进程内部保留必要上下文，通过现有诊断日志链记录：已有 operationId、失败步骤、
对象类型（当前应用、DMG、挂载候选或暂存候选）、退出码、signal 或超时，以及脱敏错误摘要。

- 错误摘要上限建议 2 KiB，不记录完整命令参数、用户绝对路径、凭证或完整许可协议。
- `verification_failed` 覆盖明确的未完成校验状态，不能靠 renderer 解析 stderr 决定下一步。
- 框架报告显式输出 `code`、`userMessage`、`retryable`，不再插值得到 `[object Object]`。
- 继续使用现有日志和报告，不新建诊断中心、日志数据库或字段级运行时统计。

### 保持现有安全和安装机制

SHA-256、Developer ID、Apple 安全评估、公证、Team ID、Bundle ID、版本和架构检查均保留。
预先 flush、stage、最终 flush、arm、commit、quit 以及 Helper 的交换、启动回执和回滚不重做。

本轮不修改 Provider、下载源、Manifest 格式、Helper 协议或权限面，不安装或初始化 Xcode，
不自动接受协议，不删除 quarantine，不关闭 Gatekeeper，不以提高超时或降低校验完成修复。
纯校验和错误处理不产生 ADR 0021 之外的新权限；若实现需要例外，必须停止并先行评审。

## 旧版本过渡

v0.1.114 的校验代码已经随旧 App 安装；远端发布新包或改 Manifest 不能替换正在运行的旧
校验实现。首个修复版 A 默认从官方 Release 下载，保存工作、手工退出并安装一次，不删除
`userData`，不移除系统安全标记。未保存或未落盘内容必须在退出前处理，不能承诺安装后找回。

用户若自行阅读并接受 Apple 许可，可能恢复旧 `lipo` 后通过旧版更新入口安装 A；这只是可选
的临时恢复路径，不是产品前置要求，不由 Studio 或 Agent 代为接受。本方案不要求受影响用户
先配置开发环境，也不新增一个用于给旧版打补丁的安装器。

正式 Release 遵守仓库发版纪律：匹配源码 CI 与发布自动门禁通过后公开，再进行真人验收。
两轮真实升级是产品完成条件，不新增发布前人工批准，也不为凑轮次连续发布无意义空版本。

## 实施范围

实现仅限局部架构检查和错误诊断函数、`mac-dmg-verifier.ts`、`update-cache.ts`、
`update-service.ts`、现有 shared 更新
错误枚举、框架诊断格式，以及对应测试和本方案相关验收文档。安装器只作为调用和清理边界
验证，原则上不修改其事务逻辑。任何额外源码文件改动必须说明对应验收项或直接阻塞。

不修改其他并行工作，不涉及 Agent runtime、云服务、布局改造或凭证存储。

## 工程门禁和当前状态

### 已通过的工程验证

2026-10-16 的局部验证结果：

- `pnpm typecheck` 通过，包含 renderer 和 main。
- 定向 ESLint 和 Prettier 检查通过，修改文件的 `git diff --check` 通过。
- `pnpm exec vitest run src/main/update src/shared/update
src/renderer/src/features/diagnostics/framework-diagnostic-report.test.ts
src/renderer/src/components/update/UpdatePanel.test.tsx --silent`：
  13 个文件、125 项测试通过。
- 架构检查覆盖 thin、FAT32、FAT64、capability bits、错误子类型、多架构、隐藏切片、越界、
  非法对齐、截断、未知头和读取异常；读取失败时文件句柄关闭。
- Verifier 使用字节头 fixture，开发工具调用会直接失败；挂载候选、复制后候选以及复制后
  架构损坏的拒绝路径均覆盖。签名、身份、版本检查没有移除。
- 两条安装入口覆盖前置记录读取和文件检查异常、候选校验异常、缓存保留后重试，以及确实
  缺失、畸形记录、大小或同长度哈希变化后的资产失效；旧版不会误退出，未验证包不会打开。
- 本次收尾先新增回归测试，复现 5 项断言失败后再修复两个生产分支；Verifier、Service 和
  UpdatePanel 三个测试文件修复后 60 项全通过。覆盖坏包失效后摘要清理、重新检查及下载
  打开的完整服务调用链，和实际“重试”按钮在有／无候选时分别调用下载／检查更新。
- 当前 App 身份不合格的回归经过真实 `MacDmgVerifier` 身份分支（系统命令使用 fixture），
  覆盖手工和自动入口：返回 `install_blocked`，保留下载字节、缓存记录及摘要，不打开、
  不 arm、commit 或 quit，自动入口释放 guard。候选身份不匹配仍作废缓存；普通下载失败
  仍保留候选并可直接重试。这些是源码级回归，不代表故障机真实升级已通过。
- 诊断覆盖实际步骤、退出状态、超时、限长、脱敏、stdout-only 错误和错误对象格式化。

另做一次本机只读校验链实验：对进程设置 `DEVELOPER_DIR=/var/empty`，以临时 TypeScript
载入器调用当前源码的候选应用校验，读取本机已安装的正式签名 v0.1.114。真实 codesign、
Gatekeeper、身份、Info.plist 和新架构检查通过，未调用开发工具。实验没有挂载 DMG、暂存、
退出、替换或启动新版，不是故障机升级成功的证据。

### 仍待完成

- 全量 `pnpm verify`、匹配源码的远端 CI 与正式发布未在上述局部验证中执行；提交和推送
  不代表正式发布或真人验收通过。
- 故障机保持 Xcode 许可未接受，手工安装修复基线后完成下一次真实应用内更新。
- 未安装开发工具环境的真实 UI 验收，以及后续两轮连续正式升级与工作现场恢复。

未运行会停止当前仓库开发进程的更新恢复 UI smoke，以免中断其他并行调试；本轮使用上述
定向测试和只读真实签名校验，不能据此宣称完整安装产品闭环完成。

现有 `scripts/update-helper-signed-smoke.mjs` 直接构造事务并启动 Helper，不能单独覆盖
`MacDmgVerifier` 的更新校验链；`scripts/update-recovery-smoke.mjs` 的缓存恢复也不能代替
真实安装。复用这些测试时必须说清它们实际证明的边界。

## 独立评审重点

1. 故障证据是否足以确认必须移除的运行时依赖，同时没有夸大成所有历史错误的唯一根因。
2. 文件头检查是否真正保持 arm64 接受语义、安全拒绝和有界读取；是否存在更小且同样可靠
   的实现，是否意外扩张为通用解析框架。
3. 单个新错误码是否足够；两条入口、缓存和重试状态是否一致，是否仍有异常被误报为发布者
   不匹配，或保留缓存后绕过重新校验。当前 App 不合格是否只阻断安装而不删除下载；确认
   坏包后是否同步清除摘要，让“重试”重新检查，且不影响普通下载失败后的直接重试。
4. 有界诊断是否满足定位需要，是否有不必要的新字段、IPC 或状态所有者。
5. 安全校验、stage 前后保存、取消清理和回滚是否保持，旧版过渡能否真实执行。
6. 工程测试是否经过实际 Verifier，真人验收是否覆盖无开发环境和连续升级，而非只证明 Helper
   或 CI 成功。

评审输出应给出“通过、需修改后通过或不通过”，列出必要修正、可删减项和最小实施范围。
独立评审指出的前置缓存复验及两个收尾分支已完成源码修复和对应回归；故障机真实验收通过前，
不得宣布 bug 已关闭。正式发布仍需单独请求。
