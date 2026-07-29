# Markdown 自动配图

> 当前事实源。最后更新：2026-07-29。

## 产品边界

Markdown 自动配图只在用户明确提出配图、插图或封面要求时执行。Agent 自动完成方案生成、图片生成、资产保存和 Markdown 引用插入；不能仅凭 Agent 主观判断静默产生外部图片调用。

当前版本：

- 支持 `.md` 和 `.markdown`。
- 支持 Meshy Text to Image。
- 支持即梦图片生成 4.0 文生图。
- 不支持 DOCX、PPTX 自动配图。
- 费用只统计，不参与预算、权限或调用控制。
- 普通写入操作仍遵守 Agent 的全局权限模式。

## Agent 接入

能力实现为内置 `ToolModule`，通过现有 `cclink_studio` MCP Server 暴露：

- `image_generation_status`：返回 Provider 配置状态、模型和当前会话图片用量。
- `markdown_illustrate`：一次完成生成、保存和插入。

Agent 不直接取得 Meshy Key 或即梦 AK/SK，不直接请求服务商 API，也不能通过多个低层工具自行拼接生成事务。编辑器作用域允许上述两个工具。省略 Provider 时，服务优先选择一个已配置的 Provider；显式指定时严格使用指定 Provider。

## 状态所有者

| 状态 | 唯一所有者 |
| --- | --- |
| Provider 密钥 | `CredentialService`；Meshy 单 Key、即梦 AK/SK 原子记录 |
| Provider 调用 | `ImageGenerationService` |
| Markdown 与 `.assets` | `FileService` / `MarkdownDocumentService` |
| Agent 与图片用量 | `UsageLedgerService` |
| 打开的编辑器草稿 | renderer `editor-store` |

`UsageLedgerService` 只追加事实事件。账本写入失败不得阻止 Agent 回复或图片生成。

## 执行流程

1. Agent 先保存并读取目标 Markdown。
2. `markdown_illustrate` 校验扩展名、版本哈希和全部插入锚点。
3. `ImageGenerationService` 调用选定 Provider，并等待异步任务终态。
4. Meshy 只下载可信 HTTPS 地址；即梦使用签名接口返回的 base64。两者统一校验 PNG/JPEG/WebP 魔数和 25MB 上限。
5. 所有成功图片写入可见的 `<文档名>.assets`。
6. `FileService` 再次比较文档哈希，以唯一原文片段定位插入点。
7. 文档和 manifest 保存成功后返回新版本哈希；失败时回滚本次新增资产。
8. Provider、模型、任务、图片数和 credits 写入用量账本。

多张图片中部分任务失败时，成功图片继续插入，失败项在工具结果中逐项返回。全部失败时不修改文档。

## 失败与降级

| 场景 | 行为 |
| --- | --- |
| 所有图片 Provider 均未配置 | 能力显示不可用，其他 Agent 能力正常 |
| 凭证无效、余额不足、限流 | 返回服务商错误，不由 CCLink 改写或拦截 |
| 即梦 AK/SK 缺少一项 | 即梦显示未配置，不影响 Meshy |
| 即梦内容审核未通过 | 返回错误码与 requestId，不保存图片 |
| 锚点缺失或不唯一 | 在产生图片调用前失败 |
| 生成期间文档变化 | 不覆盖文档，不写入生成资产 |
| 下载类型或签名异常 | 拒绝保存 |
| 资产或文档写入失败 | 回滚本次新增资产 |
| 用量账本失败 | 记录诊断，生成结果继续交付 |

## 当前限制

- Tool 以磁盘文档为事务基线。Agent 必须先调用 `editor_save`，否则打开且未保存的草稿会由编辑器现有外部变更机制提示冲突。
- Meshy 和即梦任务取消、跨进程恢复尚未实现。
- 用量账本已经持久化，图片汇总目前通过 `image_generation_status` 返回；独立的历史统计 UI 后续补齐。
- 即梦当前固定接入图片生成 4.0 文生图、单图输出；4.6、图生图和视频不在本版本。

## 验收

- 设置页可以保存或清除 Meshy Key、即梦 AK/SK，诊断日志和 Tool 参数看不到原始凭证。
- 编辑器作用域中的 Agent 能发现并调用自动配图 Tool。
- 一次调用可以生成多张图，写入 `.assets` 并插入对应 Markdown。
- 文档并发变化、锚点歧义和非法图片响应不会破坏原文件。
- Agent 模型费用与图片 credits 仅统计，不存在 `maxBudgetUsd` 调用限制。
- `pnpm verify` 通过；真实 Meshy 与即梦凭证的低额度调用需要人工 smoke。
