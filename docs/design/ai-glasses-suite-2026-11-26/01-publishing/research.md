# 渠道、工具与开放权重选型

核验日为 2026-11-26（Asia/Shanghai）。下面的“实测”特指 Studio 仓库当时的账号、文章、版本和体裁。“上游列出”指本次读到的第一方资料。此次没有以公司身份申请接口、安装第三方发布器、下载模型或发稿。产品设计以一篇镜腿试装图文为单位。

## 七个站名对应哪些发布能力

以第 196、197 天共同的六站为主表，再补第 190 天使用的小红书。知乎、掘金和 CSDN 发文章；微博、微头条、B 站动态发短图文或图集。下表按**可写的对象**选路线，一份开放平台文档只支持它明列的能力。

| 平台与目标 | 官方产品或接口的实际证据 | 首轮选择及切换条件 |
| --- | --- | --- |
| 知乎专栏 | 数据开放平台提供已授权用户公开内容查询，文档列的是 GET，需开放平台凭证；能查询文章不等于能建稿和提交。[用户内容 API](https://developer.zhihu.com/docs?key=user_contents) | 首站沿用 Studio 独立草稿、正文及图位回读、公开文章核验。数据 API 将来可评估为补充核验源，需证明文章身份、全文与三图均可取得。 |
| 掘金文章 | 官方创作中心有文章、专栏、沸点等管理入口；本轮可核的官方材料止于创作者产品。缺可给该公司应用签发的文章写入 scope、准入和回执说明。[创作中心](https://juejin.cn/creator/home) | 复用文章适配器，分类、摘要和有效标签要从发布设置面板回读；发布设置入口与最终确认分开。 |
| CSDN 博客 | 官方提供创作中心和自家多平台同步产品。官方产品的插件或会员权益不能直接提供 Studio 所需的第三方应用写入凭据。[创作中心](https://mp.csdn.net/) · [官方操作手册](https://gitcode.csdn.net/6aa0e3aa1a35784c8420aabf.html) | 复用 CSDN 自有草稿 ID、字段、日额度与审核处理。考虑接口前，需拿到当前可申请的开发者写入契约及同一稿件的查询接口。 |
| 微博图文 | 微博开放平台公告将第三方分享导向 `statuses/share`，并说明旧发帖接口受限。公告是历史迁移依据；本公司当前应用权限、三图与原生图文能力仍待平台确认。[微博开放平台公告](https://www.weibo.com/ttarticle/p/show?id=2309404090685249727364) | 原账号 UID、临时发布器、正文和图集、一次派发、必要时从同账号结果只读找回。第三方链接分享与微博长文均需另立体裁验收。 |
| 今日头条微头条 | 抖音开放平台旧“头条投稿方案”限定小视频、排除文章与微头条。另一份官方公告明确 2023-11-15 下线头条视频投稿及其数据 scope。两份文件的对象一致，旧方案已不能用作接入承诺。[旧方案](https://open.douyin.com/platform/resource/docs/ability/content-management/toutiao-publish-solution) · [下线公告](https://developer.open-douyin.com/forum/bulletin/post/65437c6341dcfdfb21a9d9ce) | 复用原微头条草稿、图集与发布前真实字段。管理页出现同稿审核记录时展示平台审核；要等公开结果核验才能完成。 |
| B 站动态 | 官方存在专栏文章投稿接口，`ATC_BASE` 需申请与用户授权，提交对象为专栏稿件；与本专题历史动态作品属于不同类型。[专栏稿件投稿文档](https://open.bilibili.com/doc/4/b14b77b6-8889-8c8b-2e83-17c5a4c550fb) | 复用 Studio 动态发布器，区分首次规范弹窗、创建请求、动态 ID 和公开页。若要开通专栏，取得真实 scope 后单独验收文章上传、提交与查询。 |
| 小红书图文笔记 | 分享开放平台官网列出图文分享、基于 App 的快速发布，核验日显示“暂停接入”；小程序另有笔记入口。两者的宿主、交互与准入条件均与桌面后台直发不同。[分享开放平台](https://agora.xiaohongshu.com/) · [小程序开放平台](https://miniapp.xiaohongshu.com/) | 保留图文笔记的本地草稿 UUID、账号及逐图身份核验。历史禁止小红书的批次继续排除；后续新稿选用需单独授权。平台转换图片 ID 而缺对应关系时转人工。 |

**引入某站官方 API 的条件。** 以该公司实得的应用身份和作用域，验证目标体裁、上传与位置、单次提交后的稿件 ID、审核及结果查询、配额与撤权。服务端 secret 不能内置在 GPL 桌面制品中。容许本地账号独立使用时，设计有界主进程凭据管理；平台需要可信服务端且公司没有合适部署时，保留现在的路线。API 与网站共用同一个 WebAffair，一旦有可能提交过，换路线也只读对账。

## 发布工具

| 选择 | 代码、授权与本机情况 | 中文渠道覆盖的证据 | 取舍 |
| --- | --- | --- | --- |
| Studio + Playwright/CDP | Studio 为 GPL-3.0-only，Playwright 为 Apache-2.0。仓库有真实 Electron 记录；这次用 Playwright 渲染原型，没有运行站内投稿。CDP 仅对 Chromium，官方注明与原生 Playwright 协议有保真度差异。[Playwright](https://github.com/microsoft/playwright) · [CDP 文档](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp) | 六站至少一轮有逐站真实操作记录；公司已有 Profile、授权、写入闸门和恢复入口。[第 196 天](../../../testing/article-day196-2026-09-28.md) | 采用。每站限制为已验证账号和具体体裁，站点改版时保留原稿、停在准确步骤。 |
| Wechatsync v2 | 开源 Chrome 扩展、CLI、MCP；仓库 GPL-3.0。允许商业用途，分发覆盖代码适用 GPL 义务。这次只审阅代码与文档。[固定版本](https://github.com/wechatsync/Wechatsync/tree/1230678434e180697e288106d9a9a4e11d84a028) · [许可证](https://github.com/wechatsync/Wechatsync/blob/1230678434e180697e288106d9a9a4e11d84a028/LICENSE) | README 列有知乎、头条号、CSDN、掘金、微博、B站专栏、小红书，默认保存草稿。抽查实现：微博进长文编辑器，B站保存专栏草稿，CSDN 写入草稿；头条号/小红书的具体体裁与本篇公开回执未在本机验证。[微博](https://github.com/wechatsync/Wechatsync/blob/1230678434e180697e288106d9a9a4e11d84a028/packages/core/src/adapters/platforms/weibo.ts) · [B站](https://github.com/wechatsync/Wechatsync/blob/1230678434e180697e288106d9a9a4e11d84a028/packages/core/src/adapters/platforms/bilibili.ts) · [CSDN](https://github.com/wechatsync/Wechatsync/blob/1230678434e180697e288106d9a9a4e11d84a028/packages/core/src/adapters/platforms/csdn.ts) | 参考 Markdown 转换、图文损耗与字段差异。不接浏览器 Cookie、不挂批量同步 MCP；其“官方 Web API”指网站编辑器使用的接口，仍需另核第三方开放许可。 |
| social-auto-upload | 主体 MIT，可商用，分发保留许可声明；部分 Skill 单独声明 MIT-0。上游提供 CLI 与 Skill，本次未安装或运行。[版本与能力表](https://github.com/dreammis/social-auto-upload/tree/409d4fdd33f3eb0d946310af93633ddb5eebe1d5) · [许可证](https://github.com/dreammis/social-auto-upload/blob/409d4fdd33f3eb0d946310af93633ddb5eebe1d5/LICENSE) | 知乎文章支持正文原位配图，小红书浏览器版支持图文；B站及微博列为视频。另列大鱼号文章、抖音图文。未见掘金/CSDN/微头条作为此版本文章能力。 | 可作为知乎图文转换的对照样本；独立 CLI 启动、账号别名与发送路径会分叉，不能直接接管 Studio 事务。 |
| Postiz | AGPL-3.0，可自托管、可商用，网络提供修改版服务需考虑相应源码提供义务；各渠道还需各自凭据。本机未部署。[仓库](https://github.com/gitroomhq/postiz-app/tree/44df988cb1840dc5eb50755536b3e6e326d27fc3) · [凭据配置](https://docs.postiz.com/self-host/providers/overview) | 官方站点列出 X、LinkedIn、YouTube、TikTok 等；核验日的渠道总表没有历史六站。TikTok 也不能替代抖音账号验收。[渠道总表](https://docs.postiz.com/general/platforms/overview) | 可参考每渠道字段、审批与日历；排除作为此业务的发布后端。 |
| CSDN 多平台同步 | 第一方产品，面向博主；商业产品访问资格与源代码分发许可分别处理，本次没有登录或购买。[官方手册](https://gitcode.csdn.net/6aa0e3aa1a35784c8420aabf.html) | 能为创作者提供多站分发工作流。未取得嵌入 Studio、回传每站逐图结果和承接现有未知派发的契约。 | 团队已有会员时可人工对照转换质量；首期继续从 Studio 原任务执行。 |

## 本地模型与落实顺序

模型只在用户选中的记录和去敏图片上提出标题、段落或图注。输出附“依据来自文件、段落或图号”。测量结果、实际佩戴体验、权利范围和量产结论由人核对。模型进程没有浏览器、发布 MCP、Cookie 或平台凭证。低内存、模型缺失、进程退出时保存编辑稿，用户可用模板继续。

| 候选与开放性质 | 本机部署路径与能承担的工作 | 决策 |
| --- | --- | --- |
| Qwen3-VL-4B-Instruct，开放权重 Apache-2.0，官方有量化文件 | 图文输入、中文整理、图注与图文匹配候选。发布者的 Q4_K_M 文件为 2,497,281,664 字节，Q8_0 视觉投影另需 453,974,304 字节，两者约 2.95 GB（十进制）；运行内存还包括视觉编码、KV 缓存与工作区。[原模型卡](https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct) · [固定 GGUF 文件](https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct-GGUF/tree/1cd86afb9a95c410a6038ab3b40d8b578c892266) · [作者代码](https://github.com/QwenLM/Qwen3-VL) | **首个可选实测候选**。以单图或小批三图、短上下文、只读输入开始，可单独固定权重与视觉投影。首版无需预装。 |
| Qwen3.5-4B，开放权重 Apache-2.0 | 官方提供图文输入与 Transformers 本机推理示例。可将同一张照片、试装记录、稿件审修任务送入对比。[固定模型卡](https://huggingface.co/Qwen/Qwen3.5-4B/blob/851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a/README.md) | 对照候选。由小样本事实保真度、改稿时间、峰值内存决定是否替换；发布时间与参数名不能代替本机成绩。 |
| Gemma 4 E2B IT，开放权重 Apache-2.0 | 官方模型卡列多语言、文本、图片及此变体的音频输入；小公司后续有语音试装记录时可复用同一评测。[官方权重](https://huggingface.co/google/gemma-4-E2B-it) · [Google 模型卡](https://ai.google.dev/gemma/docs/core/model_card_4) | 独立模型家族对照。首轮资料是中文记录与照片，音频不构成首版依赖；该批次中文表现及推理速度未测。 |
| PaddleOCR-VL-1.5，开放权重 Apache-2.0 | 作者发布的 0.9B 文档解析模型，适合照片中的测试表、数字和单位识别；上游给出本地推理及 llama.cpp 路径。[模型卡](https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.5/blob/1e5216083435c7851caad5d691ef55aab81b5949/README.md) · [PaddleOCR 代码](https://github.com/PaddlePaddle/PaddleOCR) | 仅在表格录入确有返工时引入。把提取值和原图区域交给编辑核对，不让 OCR 推断量产结论或润色成稿。 |

权重的 Apache-2.0 允许商用，并有通知与再分发条件；这说明对应权重的授权，不代表全部训练数据开放，也不授予素材肖像权和各平台发布权。推理引擎另有代码许可，例如 llama.cpp 为 MIT。当前机器读到 Apple M1、16 GiB 统一内存以及可执行文件 `llama-cli`、`llama-server`；本次没有加载上述权重，生成质量、吞吐、内存峰值均未验收。[llama.cpp 官方仓库](https://github.com/ggml-org/llama.cpp)

**小公司可执行的选型实验。** 同一批脱敏资料固定三篇：正常试装、一次失败、图片与记录的版本冲突。每篇准备一张事实对照表，标明测试条件、数值/单位、未测项、来源图。编辑先用模板，再盲审各模型结果。记录每条可核断言的来源、遗漏的限定条件、图注错配、未经证实的数字、第一稿耗时、人的改稿分钟数及运行峰值内存。拟定晋级线为零新增关键事实、零外泄、三篇图注全数可追溯，改稿时间中位数低于模板，且与 Studio 并开时可完成。达不到就保留模板。上游通用榜单不作为本机中文试装稿验收。
