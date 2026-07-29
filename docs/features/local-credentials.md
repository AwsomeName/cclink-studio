# 本地凭证管理

> 状态：代码已实现，自动化验收通过；安装包真人验收待执行  
> 最后更新：2026-07-28  
> 架构决策：`docs/decisions/0003-plaintext-local-credentials.md`

## 结论

CCLink Studio OSS 是无 CCLink 账号、无 CCLink 云服务、无操作系统钥匙串依赖的本地工作台。

用户可以在 Studio 中长期保存自己提供的第三方凭证。凭证以明文保存在 Electron `userData` 下的独立文件中，不进入工作空间、普通设置、日志、诊断或自动备份。

当前生产代码已经使用统一 `CredentialService` 和可见的 `credentials/credentials.json`，不再导入 Electron `safeStorage`。发布验收状态以 `docs/features/local-credentials-development-plan.md` 为准。

## 用户价值

用户不需要理解系统钥匙串、环境变量或多个领域各自的凭证文件。设置一次凭证后，Agent、Git 备份、数据源和扩展能力可以在本机复用。

用户始终拥有并可检查自己的凭证：

- 知道保存在哪里；
- 知道哪些功能正在使用；
- 可以显示和复制；
- 可以替换或清除；
- 可以手动迁移到另一台设备；
- 不需要 CCLink 账号或联网授权。

## 支持范围

| 凭证类别 | 典型字段                            | 使用者                                              | 默认作用域    |
| -------- | ----------------------------------- | --------------------------------------------------- | ------------- |
| 模型服务 | API Key                             | 本地 Agent、内置 Claude Code Runtime、兼容 Provider | 本机全局      |
| Git 平台 | GitHub Token                        | 手动 Git 备份、GitHub 建仓                          | 本机全局      |
| 数据源   | API Key、Bearer Token、用户名、密码 | DataSourceService                                   | 按数据源 ID   |
| 云同步   | WebDAV 密码                         | 商业装配层 SyncService                              | 按同步配置 ID |
| 扩展服务 | API Key、Token                      | 已启用的 Meshy 等扩展                               | 按服务实例    |

第一版只管理用户明确输入的第三方凭证，不管理：

- CCLink 账号、设备、消息或云服务凭证；
- Claude.ai Free/Pro/Max 登录材料；
- 浏览器 Cookie、验证码或网站会话；
- SSH 私钥、证书私钥或系统登录密码；
- 工作空间 `.env` 中已有的任意变量；
- 官方构建、签名、公证或发布上传凭证。

## 产品入口

设置页新增“本地凭证”区域。每条记录显示：

- 名称和凭证类型；
- 使用该凭证的能力；
- 已配置/未配置；
- 最后更新时间；
- 本地作用域；
- 显示、复制、替换和清除操作。

区域顶部显示：

- “凭证以明文保存在本机”的固定说明；
- 实际存储路径；
- 打开所在目录；
- 重新加载磁盘版本；
- 清除全部凭证；
- 检测到旧版加密文件时的处理提示。

## 交互规则

### 新增和替换

- 输入框默认使用密码样式。
- 保存前去除无意义首尾空白，但密码类字段是否保留空白由字段 schema 决定。
- 保存成功后清空输入框，只保留“已配置”状态。
- 替换凭证必须完成一次原子写入，失败时继续保留旧值。
- 不要求用户输入 CCLink 密码、系统密码或保险库主密码。

### 显示

- 用户点击“显示”后，只读取当前记录的目标字段。
- UI 必须明确当前显示的是明文。
- 切换设置页、关闭设置页或超时后，从 React/Zustand 临时状态清除明文。
- 不提供“一次显示全部凭证”。

### 复制

- 用户点击“复制”后，由主进程直接把目标字段写入系统剪贴板。
- Renderer 只收到成功或失败状态，不接收用于复制的明文。
- 不把复制值写入 toast、日志、诊断或操作历史。
- 第一版不自动清空系统剪贴板，避免覆盖用户随后复制的其他内容；后续如增加，必须由用户显式开启。

### 清除

- 清除单条凭证前显示凭证名称和受影响能力。
- “清除全部”需要二次确认，并列出记录数量和受影响能力。
- 清除凭证不删除非敏感连接配置、Provider 配置、工作空间 Git 绑定或 Saved Query。
- 清除后相关能力进入 `degraded/credential-required`，无关能力不受影响。

## 存储与可见性

默认路径：

```text
{userData}/credentials/credentials.json
```

macOS 典型路径：

```text
~/Library/Application Support/CCLink Studio/credentials/credentials.json
```

文件是用户可见、可复制、可手动编辑的带版本 JSON。Studio 不隐藏文件，也不使用点文件伪装。手工编辑在用户点击“重新加载磁盘版本”或重启后生效。

Store 记录加载时的文件版本摘要。用户在 Studio 运行期间从外部修改文件后，下一次 Studio 写入必须报告冲突并拒绝覆盖，直到用户重新加载磁盘版本。外部删除同样视为冲突，不能静默重建空文件。

示例：

```json
{
  "schemaVersion": 1,
  "records": {
    "agent:default": {
      "kind": "api-key",
      "fields": {
        "apiKey": "sk-example"
      },
      "updatedAt": "2026-07-28T00:00:00.000Z"
    },
    "git:github": {
      "kind": "token",
      "fields": {
        "token": "github_pat_example"
      },
      "updatedAt": "2026-07-28T00:00:00.000Z"
    }
  }
}
```

真实 schema 必须限制：

- `credentialId`、`kind` 和字段集合；
- 单字段和总文件长度；
- 时间格式和 schema 版本；
- 禁止原型污染键和未知顶层字段；
- 禁止把任意对象直接透传给 Provider 或 HTTP Header。

## 架构

```text
Settings UI
    |
    | typed credential IPC
    v
CredentialService  <---- Diagnostics projection
    |
    +---- PlaintextCredentialStore
    |
    +---- Agent credential resolver
    +---- Git backup credential resolver
    +---- Data source credential resolver
    +---- WebDAV credential resolver (commercial assembly)
    +---- Extension credential resolver
```

### 状态所有者

主进程 `CredentialService` 是唯一状态所有者：

- 文件只由它加载和修改；
- 领域服务只通过稳定 `credentialRef` 解析；
- 外部文件变化由它检测和协调重新加载；
- renderer store 不持久化明文；
- 设置、Agent、Git 和数据源不得各自维护第二份凭证文件。

### 生命周期

- 应用 ready 后加载一次凭证文件。
- 文件缺失视为正常空状态。
- 文件损坏或权限失败进入 `degraded`，保留原文件并禁止覆盖。
- 磁盘文件与已加载摘要不一致时进入 `conflict`，保留磁盘内容并要求重新加载。
- 写入通过单队列串行化，先写同目录临时文件，再原子替换。
- 窗口重建不重新创建状态所有者，只重新投影元数据。
- 退出前等待正在进行的凭证写入完成，不执行网络刷新或自动迁移。

### IPC

共享 contract 至少包括：

```ts
type CredentialStatus = 'ready' | 'degraded' | 'conflict' | 'unavailable' | 'failed'

interface CredentialMetadata {
  id: string
  kind: string
  configured: boolean
  updatedAt: string | null
  consumers: string[]
}
```

命令：

- `credentials:listMetadata`
- `credentials:set`
- `credentials:revealField`
- `credentials:copyField`
- `credentials:remove`
- `credentials:clearAll`
- `credentials:openDirectory`
- `credentials:reload`
- `credentials:getStatus`

所有 IPC 必须校验 trusted sender、命令 schema、稳定 ID、字段长度和状态。`resolveCredential` 只属于主进程内部 API，不进入 preload。

## 能力接入

### Agent

- 内置 Runtime 可以使用 Studio 保存的 Provider API Key。
- 本机/自定义 Claude Code 可以继续使用自身认证，也可以显式选择 Studio Provider 配置。
- Studio 只在创建 Agent 子进程环境时注入所需 Key。
- Key 不进入命令参数、Session 持久化或诊断。

### Git 备份

- GitHub Token 由统一凭证服务保存。
- `GIT_ASKPASS` 继续按需向 Git 子进程提供 Token。
- 远程 URL、`.git/config` 和命令参数不得包含 Token。
- SSH 地址继续使用用户本机 SSH 环境，Studio 不读取 SSH 私钥。

### 数据源

- 工作空间只保存非敏感连接配置和 `credentialRef`。
- DataSourceService 在主进程发请求前解析凭证。
- Renderer 和 Agent 工具不得取得 Authorization Header 或原始凭证。
- 删除数据源时，由产品确认决定是否同时删除凭证；第一版默认删除专属凭证，复用凭证必须阻止误删。

### 扩展服务

- 只有已启用且有真实消费者的扩展才能注册凭证类型。
- Meshy 由“图像生成”设置页管理，凭证 ID 为 `extension:meshy:default`；主进程的
  3D 和 Markdown 自动配图 Provider 是真实消费者。
- 插件不得直接读取凭证文件，只能通过受限主进程能力按 ID 请求。

## 失败与降级

| 场景                | 行为                               | 禁止行为             |
| ------------------- | ---------------------------------- | -------------------- |
| 文件不存在          | 空凭证状态，正常启动               | 报致命错误           |
| JSON 损坏           | `degraded`，保留文件，提供打开位置 | 当作空文件覆盖       |
| 文件被外部修改/删除 | `conflict`，拒绝写入，要求重新加载 | 用内存旧状态覆盖磁盘 |
| 权限不足            | `degraded`，禁止写入，提示修复权限 | 静默改存其他路径     |
| 原子写失败          | 保留旧文件和旧内存状态             | 部分提交新状态       |
| 凭证缺失            | 对应能力显示需要配置               | 阻断工作区或其他能力 |
| 凭证无效/过期       | 返回认证错误并允许替换             | 自动删除凭证         |
| 旧密文存在          | 提示重新输入或删除旧文件           | 启动时访问钥匙串     |

## 诊断

诊断可以包含：

- 凭证服务状态；
- 文件是否存在、是否可读、schema 版本；
- 记录数量；
- 每条记录的 ID、kind、configured 和 updatedAt；
- 最近一次结构化错误码；
- 是否检测到旧版密文。

诊断不得包含：

- 任意字段值；
- 长度可用于推断具体 Token 的遮罩；
- Authorization Header；
- 带凭证 URL；
- 剪贴板内容；
- 文件原文。

## 安全与隐私声明

设置页必须明确说明：

> 第三方凭证以明文保存在当前设备。CCLink Studio 不会将其上传到 CCLink 服务，但拥有当前系统用户文件权限的程序可能读取该文件。

本方案不声称抵抗本机恶意程序。真正的安全目标是隔离、最小暴露、可诊断和防止凭证误入工作空间、Git、日志及诊断。

## 验收总则

只有以下条件全部满足，才能宣称“已移除钥匙串依赖”：

- 生产依赖和生产源码中没有 `safeStorage`、`keytar` 或 Keychain 调用；
- 无凭证时完整应用正常启动；
- 四类凭证可以保存、重启恢复、按字段显示/复制、替换和清除；
- Agent、Git 和数据源真实消费统一凭证服务；
- 损坏文件不会被覆盖；
- 诊断、日志、Git 和工作空间不出现测试凭证；
- `pnpm verify`、受影响 smoke、打包应用和真人验收通过。

## 拷问

- 如果一项功能需要自己再建一个 `secrets.json`，说明唯一状态所有者失效。
- 如果“显示凭证”顺手把全部记录送到 renderer，说明最小权限失效。
- 如果 JSON 损坏后下一次保存会覆盖原文件，说明持久化恢复边界失效。
- 如果代码仍 import `safeStorage`，就不能宣称无钥匙串依赖。
- 如果文档只强调 `0600` 而不承认当前用户进程可以读取，安全声明仍然不诚实。
