# 项目内运营助手

> 状态：M7.1-M7.5 已实现，待人工验收
> 最后更新：2026-07-14
> 关联文档：`docs/features/browser-automation.md`、`docs/features/document-editor.md`、`docs/features/agent-diagnostic-log.md`

## 结论

项目运营第一版不做独立的“运营平台”、不做“每个平台一个工作区”、不做完整账号管理器。

CCLink Studio 只需要把现有能力组织成一个简单闭环：

```text
项目目录
├─ 项目资料与 Markdown 文档
├─ cclink-accounts.json
├─ 文案会话：读取项目资料，写 Markdown
└─ 平台操作会话：打开浏览器，读取账号配置，填表并等待确认提交
```

工作区仍然是项目目录。平台不是工作区，平台只是项目配置文件里的一条记录。会话负责执行任务，产物落回项目文件。

## 用户故事

用户打开 `cclink` 项目后，可以对 CCLink Studio 说：

```text
根据项目资料写一版公众号内测宣发稿，保存到 docs/公众号首发稿.md。
```

然后再说：

```text
打开微信公众号后台，把 docs/公众号首发稿.md 填到文章编辑器里，发布前让我确认。
```

CCLink Studio 需要：

- 从当前项目读取资料和草稿。
- 从 `cclink-accounts.json` 读取平台入口、账号备注和浏览器 profile。
- 使用独立浏览器 profile 打开平台。
- 让 Agent 可见地填写页面。
- 真正点击发布、提交、删除、修改资料前必须用户确认。
- 将发布结果写回项目 Markdown，例如 `docs/发布记录.md`。
- 登录、投稿、上传失败时，一键复制诊断日志用于排障。

## 项目文件约定

第一版只约定一个轻量配置文件：

```text
cclink-accounts.json
```

示例：

```json
{
  "version": 1,
  "platforms": [
    {
      "id": "wechat-mp",
      "name": "微信公众号",
      "url": "https://mp.weixin.qq.com",
      "account": "CCLink Studio",
      "notes": "扫码登录；发布前必须人工确认。",
      "browserProfile": "wechat-mp"
    },
    {
      "id": "zhihu",
      "name": "知乎",
      "url": "https://www.zhihu.com",
      "account": "CCLink Studio",
      "notes": "用于专栏文章和问答。",
      "browserProfile": "zhihu"
    }
  ]
}
```

边界：

- 不存密码。
- 可以记录账号名、登录方式、2FA 提示、注意事项。
- 密码、Token、恢复码等秘密信息不进入项目可见文件；后续如支持密码，只保存加密凭据引用。
- `browserProfile` 用于隔离登录态和 Cookie。
- 发布记录先写 Markdown，不单独建数据库。

## 会话模型

### 文案会话

职责：

- 读取项目资料、README、历史文案、发布记录。
- 写、改、拆分 Markdown 文案。
- 将结果保存到项目文件。

输出：

- `docs/宣发方案.md`
- `docs/公众号首发稿.md`
- `docs/知乎版本.md`
- `docs/发布记录.md`

### 平台操作会话

职责：

- 读取 `cclink-accounts.json`。
- 根据平台 id 打开 URL。
- 优先使用对应 `browserProfile` 恢复登录态；如果登录实际发生在默认 Session，面板会明确标出并复用该 Session。
- 读取指定 Markdown 文件。
- 在浏览器中填表、上传素材、截图、下载资料。
- 在提交前发起确认。

输出：

- 页面已填好，等待用户确认发布。
- 发布成功后写入 `docs/发布记录.md`。
- 如果失败，写明平台、页面、动作、错误和下一步建议。

## 权限规则

低风险动作可自动执行：

- 打开页面。
- 读取项目文件。
- 填写表单草稿。
- 上传用户指定文件。
- 截图。
- 复制内容。

高风险动作必须确认：

- 发布文章。
- 提交审核。
- 删除内容。
- 修改账号资料。
- 发送私信或评论。
- 购买、支付、下单。
- 大批量操作。

确认卡片必须说明：

- 平台。
- 账号备注。
- 页面 URL。
- 将要点击的按钮或执行的动作。
- 使用的文案文件。

## M7 里程碑拆分

### M7.1：项目账号配置文件

目标：让项目目录能声明平台入口和账号备注。

方案：

- 定义 `cclink-accounts.json` schema。
- 增加读取/校验工具。
- 在当前工作空间中展示可用平台列表，先不做复杂 UI。

验收：

- [x] 缺少文件时给出创建建议。
- [x] JSON 格式错误能定位到字段。
- [x] 能读取平台 `id/name/url/account/notes/browserProfile`。

### M7.2：文案会话写入项目文档

目标：让 Agent 围绕当前项目资料生成 Markdown 文案。

方案：

- 文案会话读取当前工作空间文件。
- 使用现有 editor MCP 工具写入 Markdown。
- 生成内容默认保存到用户指定路径。

验收：

- [x] 能创建平台文案草稿文件，例如 `docs/公众号首发稿.md`。
- [x] 能创建绑定当前项目的文案工作会话，并预填读取项目资料、改写 Markdown 的任务说明。
- [x] 所有产物都落在项目目录，不落入全局数据库。

### M7.3：平台浏览器 Profile

目标：按平台隔离登录态。

方案：

- `browserProfile` 映射到独立浏览器持久化上下文。
- 打开平台时优先使用配置里的 profile。
- 不处理密码，只保留用户手动登录后的 Cookie 和站点状态。

验收：

- [x] 微信公众号和知乎可以使用不同 `browserProfile`。
- [x] 浏览器使用 `persist:cclink-studio-profile-${browserProfile}` 持久化上下文，重启后可恢复站点登录态。
- [x] 平台操作会话和侧栏会显示当前使用的 profile。

### M7.4：平台操作会话

目标：让 Agent 能读取平台配置和 Markdown，打开页面并准备提交。

方案：

- 命令格式先走自然语言，不先做复杂表单。
- Agent 读取 `cclink-accounts.json` 和目标 Markdown。
- 浏览器自动化填入标题、正文、素材。
- 发布前走确认卡片。

验收：

- [x] 能打开配置平台。
- [x] 能创建平台操作会话，并预填平台 URL、账号备注、登录说明、profile、目标 Markdown 和确认要求。
- [x] 提交前必须确认的规则写入平台操作会话任务说明。
- [x] 失败时保留页面现场；错误说明由当前浏览器任务/Agent 会话承接。

### M7.5：发布记录

目标：形成最小可追溯记录。

方案：

- 发布成功或用户标记成功后，追加到 `docs/发布记录.md`。
- 记录平台、账号备注、URL、文案文件、时间、状态、备注。

验收：

- [x] 发布后能追加 `docs/发布记录.md`。
- [x] 同一文案多平台发布能形成多条记录。
- [x] 手动失败或取消也能记录原因。

## 当前实现

- 新增 `ProjectOpsService` 和 `projectOps` preload API，负责 `cclink-accounts.json`、文案草稿和发布记录写回。
- 工作空间侧栏新增“项目运营”区，只在本地工作空间显示。
- 可一键创建 `cclink-accounts.json` 模板。
- 兼容读取旧 `deepink-accounts.json`、`.cclink-studio/accounts.json` 和 `.deepink/accounts.json`，但新建和文档约定统一使用项目根目录 `cclink-accounts.json`。
- 可按平台创建文案草稿和文案工作会话。
- 可按平台打开独立浏览器 profile，并创建平台操作工作会话。
- 可追加 `docs/发布记录.md`。
- 浏览器 Tab 支持 `browserProfile`，主进程使用独立持久化 partition 隔离登录态。
- 运营侧栏轮询平台 Profile 和默认 Session 的脱敏 Cookie 元数据，显示登录是否持久保存以及 Profile 是否错位。
- 默认平台包含 V2EX；首次进入未登录的 V2EX 时打开注册页，并使用独立 `v2ex` Profile 保存登录态。
- V2EX 会话可自动浏览节点、主题和回复，准备文案、填写表单并预览；最终创建主题、回复或保存修改由工具宿主强制逐次确认。
- V2EX 发布确认是运行时硬约束，在 `auto` 权限模式下仍生效，且不允许设置“始终允许”。

验证：

- `pnpm test -- --run`
- `pnpm build`

待人工验收：

- 用真实项目创建配置模板。
- 手动登录两个平台，确认 profile 不串。
- 用文案会话生成 Markdown。
- 用平台操作会话填内容。
- 人工确认发布后追加发布记录。

## 暂不做

- 不做密码库。
- 不做多账号批量营销。
- 不做平台全覆盖模板市场。
- 不做定时任务系统。
- 不做完整社媒管理后台。
- 不做评论自动回复；第一版只做读取、总结和草拟回复。

## /grilling

结论先说：这条线可以很快变成 CCLink Studio 的真实可用场景，但前提是保持简单。

如果第一版把“平台”做成工作区，会污染工作空间模型；平台只是项目里的配置。

如果第一版做密码库，会立刻进入安全、合规、2FA、风控和恢复机制的深水区，反而拖慢宣发闭环。

如果第一版做完整发布系统，会和现有浏览器自动化、Markdown 编辑器重复造轮子。现在需要的是会话编排，不是新产品壳。

最该验证的是一次真实任务：

1. 在 `cclink` 项目里写一篇宣发文案。
2. 用平台操作会话打开目标平台。
3. Agent 填好内容。
4. 用户确认提交。
5. 发布结果写回项目文档。

这五步跑通，CCLink Studio 就开始真正服务项目运营；跑不通，再漂亮的平台模型都没意义。
