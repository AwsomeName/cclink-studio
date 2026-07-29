# 本地凭证管理开发计划

> 状态：M0-M5 与扩展凭证迁移已完成；M6 自动化和 arm64 打包通过，arm64 真人验收及 x64 打包/真人验收待执行
> 最后更新：2026-07-28  
> 产品事实源：`docs/features/local-credentials.md`  
> 架构决策：`docs/decisions/0003-plaintext-local-credentials.md`

## 结论

本改造不能通过把三个 `secrets.enc` 改名为 `secrets.json` 完成。它同时改变安全声明、状态所有者、IPC 权限、设置交互、领域依赖、旧数据处理和诊断边界。

里程碑必须按 M0 到 M6 顺序推进。M0-M2 建立新底座但不删除旧实现；M3-M4 迁移消费者；M5 才允许删除 `safeStorage`；M6 完成发布级验收。

当前实现进度：

| 里程碑 | 状态        | 证据                                                                            |
| ------ | ----------- | ------------------------------------------------------------------------------- |
| M0     | ✅ 完成     | ADR、产品事实源、凭证 ID 与 IPC 契约已冻结                                      |
| M1     | ✅ 完成     | `PlaintextCredentialStore`、`CredentialService` 及损坏/冲突测试                 |
| M2     | ✅ 完成     | 设置页、trusted IPC、字段级显示/复制、清除与重新加载                            |
| M3     | ✅ 完成     | Agent 与 Meshy 通过统一服务动态解析                                             |
| M4     | ✅ 完成     | Git 与数据源旧 Store 已删除，统一使用稳定 credential ID                         |
| M5     | ✅ 完成     | `safeStorage` 生产引用清零，边界脚本进入 `pnpm verify`                          |
| M6     | 🔄 部分完成 | `pnpm verify` 与 arm64 打包验证已通过；arm64 真人验收及 x64 打包/真人验收待执行 |

任一阶段只要出现凭证进入工作空间、日志、诊断、全量 renderer 状态或 Git 提交，立即停止后续开发并修复。

## 总体范围

### 要完成

- 一个主进程 `CredentialService`。
- 一个带版本、原子写入的 `PlaintextCredentialStore`。
- 一个设置页“本地凭证”产品面。
- 定向保存、按字段显示/复制、替换和清除。
- Agent、Git、数据源及有效扩展的统一凭证解析。
- 商业覆盖层的 WebDAV 密码通过统一服务本地持久化，不再另设内存或密文 Store。
- 旧密文检测和重新输入流程。
- 删除 OSS 生产路径中的系统钥匙串依赖。
- 自动化、smoke、打包和真人验收。

### 不在本轮

- 主密码或加密保险库。
- CCLink 账号 Session、官方云端凭证托管或跨设备凭证同步。
- 浏览器 Cookie、网站会话和验证码管理。
- SSH 私钥托管。
- 团队共享凭证或远程 Agent 凭证下发。
- 自动读取工作空间 `.env` 的全部变量。

## 目标架构

```text
shared credential contracts
          |
          v
main CredentialService
    |
    +-- PlaintextCredentialStore
    +-- metadata projection
    +-- clipboard adapter
    +-- consumer resolver
          |
          +-- Agent
          +-- Git backup
          +-- Data source
          +-- Commercial WebDAV adapter
          +-- enabled extensions
```

状态所有者是 `CredentialService`。持久化 owner 是 `PlaintextCredentialStore`。领域服务不缓存可变凭证，只在需要时按稳定引用解析。

## M0：事实源、库存和契约冻结

### 目标

在写代码前固定凭证范围、稳定 ID、存储 schema、IPC 权限和迁移边界，消除现有文档冲突。

### 方案

- 接受 ADR 0003。
- 建立 `docs/features/local-credentials.md`。
- 盘点所有生产代码、测试、文档和磁盘路径中的：
  - `safeStorage`；
  - `SettingsCredentialStore`；
  - `GitBackupCredentialStore`；
  - `DataSourceCredentialStore`；
  - `apiKey`、`meshyApiKey`、GitHub Token 和数据源 secret。
- 定义凭证 ID 命名规则：
  - `agent:<profileId>`；
  - `git:<providerId>`；
  - `data-source:<sourceId>`；
  - `extension:<extensionId>:<instanceId>`。
- 定义 `credentials.json` schema、最大记录数、字段长度和文件上限。
- 定义共享 IPC contract、错误码和 capability 状态。
- 固定 credential ID 本身就是引用值，例如 `data-source:<sourceId>`；不得再叠加 `credential:` 等第二层协议前缀。
- 明确 Meshy 是真实消费者还是遗留字段；没有完整入口则列入删除清单。

### 交付物

- ADR、产品文档、开发计划。
- 凭证库存表。
- shared 类型和 Zod schema 设计草案。
- 迁移映射表：旧文件、旧字段、目标 credential ID、消费者。

### 验收标准

- [x] 文档能回答每一类凭证由谁保存、谁消费、作用域是什么。
- [x] 不再出现“Studio 不保存 API Key”和“Studio 保存 API Key”同时成立的当前描述。
- [x] 所有旧凭证路径都有迁移或删除结论。
- [x] 产品明确承认本地明文威胁模型。
- [x] 架构评审确认无需第二状态所有者或新的官方集成依赖。

### 失败判定

- 仍以字段名而非稳定 credential ID 跨模块耦合。
- 没有决定 renderer 是否可以显示/复制明文。
- 计划依赖自动访问 Keychain 迁移旧数据。

## M1：凭证存储与主进程服务

### 目标

实现不依赖 Electron `safeStorage` 的统一主进程凭证底座，但暂不切换现有消费者。

### 方案

- 新增 `src/main/credentials/plaintext-credential-store.ts`。
- 新增 `src/main/credentials/credential-service.ts`。
- 新增 `src/shared/ipc/credentials.ts` 和严格运行时 schema。
- 使用 `app.getPath('userData')/credentials/credentials.json`。
- 文件缺失时返回空状态。
- 加载时校验 schema、记录 ID、字段类型、长度和总大小。
- 文件损坏、权限失败和未知版本进入结构化 `degraded`。
- 加载时记录磁盘文件版本摘要；写入前发现外部修改或删除时进入 `conflict` 并拒绝覆盖。
- 写入使用：
  - 单一 mutation queue；
  - 同目录随机临时文件；
  - `0600` 权限；
  - `rename` 原子替换；
  - 失败后删除临时文件并保留旧状态。
- 新值成功落盘后才提交内存状态。
- 注册到统一 runtime，定义启动、窗口重建和 shutdown 行为。

### 错误模型

至少包括：

- `CREDENTIAL_FILE_INVALID`
- `CREDENTIAL_SCHEMA_UNSUPPORTED`
- `CREDENTIAL_PERMISSION_DENIED`
- `CREDENTIAL_READ_FAILED`
- `CREDENTIAL_WRITE_FAILED`
- `CREDENTIAL_FILE_CHANGED`
- `CREDENTIAL_NOT_FOUND`
- `CREDENTIAL_FIELD_INVALID`
- `CREDENTIAL_SERVICE_DEGRADED`

### 测试

- 空文件和文件不存在。
- 正常加载和重启恢复。
- 并发 set/remove 串行化。
- 临时文件写入失败。
- rename 失败。
- JSON 损坏和未知 schema。
- 运行期间外部修改、外部删除和显式重新加载。
- 文件权限。
- 超长字段、未知字段和原型污染键。
- 失败后旧内存和旧文件保持一致。

### 验收标准

- [x] 新 Store 和 Service 不 import `safeStorage`。
- [x] 损坏文件不会被覆盖或静默清空。
- [x] 外部修改不会被内存旧状态覆盖，重新加载后可以继续写入。
- [x] macOS/Linux 新文件权限为 `0600`。
- [x] 原子写失败后旧凭证仍可读取。
- [x] 凭证服务失败不阻断设置、工作空间、浏览器、编辑器和 Terminal 启动。
- [x] 单元测试覆盖全部错误码和并发路径。

### 失败判定

- Store 自己承担 UI 或领域逻辑。
- Agent/Git/数据源绕过 Service 直接读文件。
- 解析失败后把状态设置为空并允许下一次保存覆盖原文件。

## M2：设置页、IPC 和显式用户操作

### 目标

交付统一“本地凭证”设置体验，同时保持 renderer 默认看不到凭证值。

### 方案

- 注册 credential IPC 和 preload 白名单。
- 设置页增加凭证列表、状态、存储路径和明文风险说明。
- 支持：
  - 新增/替换；
  - 按字段定向显示；
  - 按字段主进程复制；
  - 单条清除；
  - 清除全部；
  - 打开所在目录；
  - 重新加载磁盘版本。
- `revealField` 只返回单个 ID、单个字段的单次结果。
- 明文不写入 Zustand 持久状态；关闭行、切换页面或超时后清除组件临时状态。
- `copyField` 由主进程写 clipboard，只向 renderer 返回结果。
- 删除操作展示受影响消费者并要求确认。
- 凭证服务 `degraded` 时允许查看状态和打开目录，禁止覆盖写入。
- 凭证服务 `conflict` 时提供“重新加载磁盘版本”，不得把内存旧状态写回。

### IPC 安全

- trusted renderer guard。
- 严格 command schema。
- 稳定 ID allowlist/registry。
- 单字段和总 payload 长度限制。
- 不接受 renderer 提供文件路径。
- 错误响应不携带凭证值或文件原文。

### 测试

- IPC sender、schema 和长度拒绝。
- 列表只返回元数据。
- reveal 只返回目标记录的目标字段。
- copy 不把值返回 renderer。
- 清除确认和受影响能力摘要。
- 组件卸载后临时明文清除。
- degraded 状态禁止覆盖。

### 验收标准

- [x] 用户可以保存、重启、显示、复制、替换和清除测试凭证。
- [x] 默认 UI、Zustand 快照和诊断中没有凭证值。
- [x] 设置页明确显示明文存储说明及实际目录。
- [x] 复制操作不经过 renderer 明文返回。
- [x] 文件损坏时 UI 不显示“未配置”误导用户。
- [x] 文件被外部修改时 UI 提示冲突，重新加载前不能保存。
- [x] UI 自动化覆盖关键操作和失败提示。

### 失败判定

- 提供 `getAllSecrets()`。
- 为了显示一条记录而把整个文件送到 renderer。
- toast、错误或调试日志输出输入值。

## M3：Agent 与扩展凭证迁移

### 目标

让本地 Agent 使用统一凭证服务，并清理 Settings 中的密钥所有权。

### 方案

- Agent Runtime 按 `credentialRef` 解析 Provider API Key。
- `SettingsService` 只保存 Provider、Base URL、模型和 `credentialRef`。
- 创建子进程环境时才取得 Key，并继续只通过环境变量注入。
- Session、conversation、runtime fingerprint 和诊断不记录 Key。
- 本机/自定义 Claude Code 自身认证与 Studio Provider 凭证保持显式选择，不自动导入 Claude 登录材料。
- 盘点 `meshyApiKey`：
  - 有完整能力和设置入口则注册扩展凭证；
  - 没有则删除设置字段、IPC 和死代码，不迁移空壳。

### 测试

- 内置 Runtime 有 Key、无 Key、错误 Key。
- 本机 Claude Code 自身认证路径不要求 Studio Key。
- Agent 子进程环境包含目标 Key，但日志和诊断不含 Key。
- Provider 切换不会误用上一 Provider 凭证。
- 活动 Agent run 期间替换凭证只影响新 backend/generation。

### 验收标准

- [x] Agent 不再读取 `SettingsCredentialStore`。
- [x] 普通 `settings.json` 不包含 Key，只包含引用。
- [x] 内置 Runtime 可以使用新凭证完成最小连接测试。
- [x] 本机 Claude Code 无 Studio Key 时仍按自身认证边界工作。
- [x] Meshy 有明确保留或删除结论。
- [x] Agent 日志、诊断和会话快照不包含测试 Key。

### 失败判定

- 凭证变化直接修改正在运行的 backend 环境。
- 为兼容旧设置继续保留第二套运行时密钥状态。
- 自动读取或复制 Claude.ai 登录材料。

## M4：Git 备份与数据源迁移

### 目标

删除 Git 和数据源各自的凭证所有权，统一通过 `CredentialService` 消费。

### 方案

分别迁移 Git 与数据源消费者，共享凭证解析、缺失降级和诊断脱敏规则，不保留领域专属存储。

### Git 方案

- GitHub Token 使用 `git:github` 或稳定账号 ID。
- Git 设置只保存 provider、username 和 credentialRef。
- `GIT_ASKPASS` 在执行时解析 Token。
- Token 不进入 URL、命令参数、`.git/config` 或 Git 输出。
- 清除 Token 后保留工作空间远程绑定，但状态变为 `credential-required`。

### 数据源方案

- 工作空间连接配置直接使用稳定 credential ID，例如 `data-source:<sourceId>`，不使用 `keychain:` 或第二层协议前缀。
- DataSourceService 在主进程执行请求前解析。
- 删除专属凭证前检查是否被其他数据源引用。
- 数据源配置复制到另一台机器后仍能显示，但要求重新配置本机凭证。
- Authorization Header、URL 查询参数和 adapter 错误保持脱敏。

### 测试

- GitHub 连接测试、建仓和 `GIT_ASKPASS`。
- Git 错误、远程 URL 和诊断脱敏。
- 数据源四种认证模式及凭证缺失。
- 共享凭证引用与删除保护。
- 工作空间复制不携带凭证。
- Git 备份预检明确排除 `credentials.json` 及其目录。

### 验收标准

- [x] Git 和数据源不再创建独立 `secrets.enc`。
- [ ] Git 备份真实使用统一凭证完成测试 Push。
- [ ] 数据源真实使用统一凭证完成只读连接测试。
- [x] 清除凭证只降级对应能力，不删除连接或工作空间绑定。
- [x] 工作空间、Git 提交、日志和诊断不包含测试凭证。
- [x] 数据源配置中的 `authRef` 不再使用 `keychain:`。

### 失败判定

- Git 或 DataSourceService 缓存一份可变凭证形成第二状态。
- 删除一个数据源误删其他连接共用的凭证。
- 为方便调试把 Authorization Header 写入诊断。

## M5：旧数据处理与钥匙串依赖清零

### 目标

完成旧实现退场，使 OSS 默认生产路径不再包含系统钥匙串能力。

### 方案

- 检测以下旧文件是否存在，但不读取内容：
  - `settings/secrets.enc`
  - `git-backup/secrets.enc`
  - `data-source/secrets.enc`
- 设置页显示旧凭证来源和“重新输入”提示。
- 用户完成新凭证配置后，可以删除对应旧文件。
- 删除：
  - `SettingsCredentialStore`
  - `GitBackupCredentialStore`
  - `DataSourceCredentialStore`
  - 相关 safeStorage mock 和迁移分支
- 删除生产代码中的 Electron `safeStorage` import。
- 从依赖和文档中清理 `keytar`、Keychain 和加密存储当前描述。
- 增加 `verify:credential-boundary`，阻止生产代码重新引入：
  - `safeStorage`
  - `keytar`
  - Apple Keychain API
  - 工作空间内凭证文件
- 保留旧文件删除前的明确确认，不自动清理。

### 测试

- 旧文件存在/不存在检测。
- 启动期间没有解密调用。
- 重新输入成功后的删除确认。
- 删除失败时保留提示，不影响新凭证。
- 静态边界脚本正反例。
- 打包产物源码/依赖扫描。

### 验收标准

- [x] `rg "safeStorage|keytar|Keychain|keychain" src package.json pnpm-lock.yaml` 不命中生产依赖和生产代码。
- [x] 启动、打开设置和使用无凭证能力都不触达系统钥匙串。
- [x] 旧密文不会被自动删除或覆盖。
- [x] 用户可以通过重新输入恢复所有仍需要的凭证。
- [x] 边界脚本已进入 `pnpm verify`。
- [ ] 打包应用在干净 macOS 用户环境中不出现钥匙串访问提示。

### 失败判定

- 为自动迁移旧密文继续保留 `safeStorage`。
- 只删除调用但依赖、mock、文档和打包代码仍保留。
- 静态扫描仅检查文件名，不检查生产 import。

## M6：诊断、回归和发布验收

### 目标

证明新凭证体系在真实安装包中可用、可诊断、不会泄漏，并且无关能力不受影响。

### 方案

- 诊断加入凭证服务状态、schema、记录元数据和旧文件存在状态。
- 建立固定 canary secret，贯穿单元测试、IPC、日志、诊断、Git 和 Agent 快照泄漏扫描。
- 执行完整 verify 和受影响 smoke。
- 构建 macOS arm64/x64 本地包，在新用户目录和升级用户目录分别验收。
- 人工测试复制、显示、重启、文件损坏、权限拒绝、旧文件提示和真实消费者。

### 自动化门禁

```bash
pnpm verify
pnpm smoke:local
pnpm smoke:ui
pnpm smoke:workflow
pnpm smoke:restore
pnpm smoke:standalone
pnpm verify:credential-boundary
```

### 真人验收矩阵

| 场景                  | 预期                               |
| --------------------- | ---------------------------------- |
| 全新安装，无凭证      | 正常启动，无钥匙串提示             |
| 保存 Agent Key 后重启 | 已配置，Agent 可使用               |
| 显示和复制            | 只操作目标凭证                     |
| GitHub Token          | 连接测试和真实私有仓库 Push 成功   |
| 数据源凭证            | 只读连接与查询成功                 |
| JSON 损坏             | 显示 degraded，不覆盖原文件        |
| 文件只读              | 保存失败，旧凭证仍在               |
| 文件运行中被外部修改  | 保存被拒绝，重新加载后显示磁盘版本 |
| 旧 `secrets.enc` 存在 | 仅提示重新输入，不访问钥匙串       |
| 复制诊断              | 不含 canary secret                 |
| Git 备份              | 不提交 credentials 目录            |

### 验收标准

- [x] 所有自动化门禁通过。
- [ ] arm64/x64 打包产物完成凭证流程人工验收。
- [x] canary secret 不出现在日志、诊断、工作空间、Git、MCP 或 Agent 消息。
- [x] 设置、Agent、Git、数据源的错误提示可区分缺失、无效、存储损坏和权限失败。
- [x] 无凭证和凭证服务 degraded 时，无关能力全部可用。
- [x] 产品文档、架构文档和当前代码事实一致。

### 失败判定

- 只用单元测试证明“没有钥匙串提示”。
- 只验证保存，不验证损坏恢复和泄漏扫描。
- 打包应用与开发模式行为不同但仍宣称完成。

## 里程碑依赖与完成定义

```text
M0 -> M1 -> M2 -> M3 -> M4 -> M5 -> M6
```

- M1 未完成，不允许新消费者直接读 `credentials.json`。
- M2 未完成，不允许删除旧设置入口。
- M3/M4 未完成，不允许删除旧凭证 Store。
- M5 未完成，不允许宣称“无苹果钥匙串依赖”。
- M6 未完成，不允许发布或打包为新的验收版本。

每个里程碑需要代码、测试、文档和对应验收证据同时完成。测试通过但文档仍描述 `safeStorage`，或者代码已迁移但打包应用仍触发 Keychain，都不算完成。

## 最终拷问

- 是否真的删除了钥匙串依赖，还是只把调用藏到了迁移代码？
- 是否真的只有一个凭证状态所有者，还是各领域仍保留缓存和文件？
- 是否能处理损坏文件而不丢数据？
- 是否能证明凭证没有进入诊断、Git 和 Agent 上下文？
- 是否在真实打包应用和新用户环境中验证，而不只在开发模式自测？
