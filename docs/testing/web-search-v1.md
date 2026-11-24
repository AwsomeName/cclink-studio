# 联网搜索（DeepSeek）首版验收

> 日期：2026-11-24。
> 状态：代码与工程门禁通过，真实 Electron 设置页自动化通过；尚未用真实 DeepSeek Key 实际搜索，真人验收待完成。
> 设计：[DeepSeek 接入效果稿](../design/deepseek-integration-2026-11-24/README.md)。

## 用户功能进度

用户现在可以：

- 在 **设置 · API Key 与连接 · 联网搜索** 启用联网搜索：沿用 Claude Code 中保存的 DeepSeek Key，或单独填写一个；设置每月调用上限和默认结果条数；点“验证：搜索一次并读取一页”，两步都成功才启用；可随时停用。
- 在 **设置 · Agent 行为与工具 · 联网搜索** 看到 `web_search`、`web_fetch` 两个只读工具，并按 Codex / Claude Code / Owner 分别开关（默认 Codex 开、Claude Code 关、Owner 开）。
- 启用后，Codex（以及打开开关的 Claude Code）会话里 Agent 可以搜索网页、读取网页正文；会话“执行过程”里显示搜索词、结果标题和网址、估算费用。
- 在 **设置 · 模型用量** 看到本月搜索、读取、未计费次数、估算费用、上限进度和按来源拆分。
- Claude Code 选 DeepSeek 时，模型改为 `deepseek-flash`（默认、推荐）/ `deepseek-v4-pro` 二选一，并说明能否看图和价格；已保存 `deepseek-chat` 的用户看到一次改用提示，不自动修改。

用户还不能：

- 在 Owner 调研简报或公司“帮我想清楚”里勾选联网搜索（Owner 的执行会话只读 Studio 提供的资料，需要单独改调研流程，见下文）。
- 在 Claude Code 的“验证连接”里看到联网搜索一项（效果稿 ①的第三项检查）。

## 规则与边界

- 搜索和读取只在主进程调用 `https://api.deepseek.com/v1/tools/search` 与 `/v1/tools/fetch`；只发送搜索词和网址，密钥每次从本机凭证读取，不返回给页面或 Agent。
- 工具是否出现由宿主在创建 MCP 会话时决定（`agentBackend`、`forceVisibleBrowser`），模型不能改；绑定可视浏览器的任务看不到这两个工具，直接调用也会被拒绝。
- 未启用、缺 Key、超出上限时：工具不出现或返回明确原因；本地功能不受影响。
- 计数与 DeepSeek 计费口径一致：搜索无结果、失败、超时记为“未计费”。用量只存在本机 `userData/web-search/state.json`。
- 搜索结果不能证明网页上的操作已完成；发布、登录等仍由可视浏览器核验。

## 真人可执行步骤

1. 设置 · API Key 与连接 · 联网搜索：选“沿用 Claude Code 中保存的 DeepSeek Key”（或单独填写），点“验证：搜索一次并读取一页”。预期：显示搜索返回条数和读取的网页，状态变为“✓ 已启用”（会产生约 $0.0015）。
2. 新建 Codex 会话，问一个需要最新信息的问题，例如“查一下 2026 年主流 AR 眼镜的续航，给出来源”。预期：执行过程中出现“联网搜索”“读取网页”，回答带网址。
3. 设置 · 模型用量：预期联网搜索次数增加、按来源显示“Codex 会话”。
4. 把每月上限改成当前已用次数，再让 Agent 搜索。预期：Agent 说明已达上限，不再调用。
5. 停用联网搜索后新建会话。预期：Agent 看不到这两个工具，其他功能正常。

真人结果：尚未执行。

## 工程准备度与实际证据

- `pnpm verify` 通过：490 个测试文件、4200 项通过，18 项跳过，含构建。
- 服务测试 8 项：默认停用且不联网、验证成功才启用并持久化、验证失败保持停用并给出原因、无结果不计费与月上限、沿用 Key 与单独 Key、拒绝含账号密码或非 http(s) 网址与超长搜索词、按 Agent 和可视浏览器任务的可见性、工具返回带网址的结果。
- 工具宿主测试：模块对某会话不可见时，`tools/list` 不列出、`tools/call` 拒绝且不执行。
- `node scripts/web-search-smoke.mjs` 在真实 Electron（隔离用户数据，仅保存假测试 Key，不向 DeepSeek 发请求）中 7 项通过（[结果](web-search-v1/result.json)）：默认未启用、设置页、保存单独 Key 不启用、启用后状态、Agent 工具页与按 Agent 开关、模型用量、DeepSeek 模型选择。

截图（测试数据）：[联网搜索未启用](web-search-v1/01-search-service-empty.png) · [已启用](web-search-v1/02-search-service-ready.png) · [Agent 工具](web-search-v1/03-agent-tools.png) · [模型用量](web-search-v1/04-usage.png) · [DeepSeek 模型选择](web-search-v1/05-deepseek-model.png)。

## 尚未完成

1. **真实搜索未实测**：需要用户的 DeepSeek Key 做一次验证（约 $0.0015）和一次 Codex 会话搜索。
2. **Owner 调研**：执行会话按设计不调用工具，公开资料由 Studio 获取（目前只支持 GitHub 仓库）。接入联网搜索需要：简报增加“允许联网搜索”和次数上限、由 Studio 搜索并读取网页后交给执行会话、简报引用支持网址与读取时间。工具侧已预留 `webSearchSource: 'owner'` 与 `webSearchAllowed`。
3. **公司“帮我想清楚”**：同上，依赖 Owner 调研的网页来源。
4. **Claude Code 验证连接中的联网搜索检查**：需要让 Claude Code 实际调用一次内置搜索，尚未实现。
