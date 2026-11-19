# 宣传文案事实与图片来源

核对日期为 2026 年 10 月 16 日。文案使用仓库的产品定位与功能事实，不以设计效果图或界面入口替代能力验收。

## 文案依据

| 对外表述 | 依据 | 本稿采用范围 |
| --- | --- | --- |
| 单一开源桌面应用，本地能力免费免 CCLink 登录 | [仓库 README](../README.md)、[项目规则](../AGENTS.md)、[架构说明](../docs/architecture.md) | 区分本地能力、第三方模型服务与可选远程服务 |
| 本地工作空间组织文件、草稿、标签页和会话 | [工作空间系统](../docs/features/workspace-system.md) | 介绍基础工作组织与状态保存，不宣称所有恢复边界均已真人复验 |
| Agent 在授权范围内操作可见网页 | [浏览器自动化](../docs/features/browser-automation.md)、[架构说明](../docs/architecture.md) | 介绍可见网页与人工接管，不保证任意站点任务成功 |
| Markdown 可视化编辑与工具读写 | [文档编辑器](../docs/features/document-editor.md) | 使用当前 Markdown 能力，不宣传 Word、PPT、Excel 完整编辑 |
| 当前完整工具 Agent 使用 Claude Code 后端 | [Agent 系统](../docs/features/agent-system.md)、[README](../README.md) | 交代运行时、用户认证或受支持的模型服务配置；不承诺任意 API 可直接替换 |
| 本地终端 | [终端标签页模型](../docs/features/terminal-tab-model.md)、[README](../README.md) | 运行命令和查看输出 |
| Elasticsearch 只读查询 | [数据源](../docs/features/data-sources.md) | 在社区稿中列作条件化能力，保持只读边界 |
| 用户自有 Android 真机连接 | [Android 设备](../docs/features/agent-device.md)、[README](../README.md) | 只介绍自有 USB 或 Wi-Fi ADB 真机，不写模拟器或托管设备 |
| GPL-3.0-only 与当前 macOS 目标平台 | [package.json](../package.json)、[README](../README.md) | 所有版本使用相同许可和平台口径 |
| 源码启动的环境配置 | [当前 CI](../.github/workflows/ci.yml)、[package.json](../package.json)、[README](../README.md) | 社区精修稿使用 Node.js 22 与 pnpm@11.5.0；是仓库配置事实，不是全新环境安装验收 |
| 源码职责与贡献方式 | [架构说明](../docs/architecture.md)、[开发指南](../docs/development.md)、[贡献指南](../CONTRIBUTING.md) | 技术职责以当前架构为准；贡献指南只采用问题复现、讨论和集中改动等流程，不沿用其中遗留的旧双桌面边界文字 |

## 真实截图

| 图片 | 来源与实际状态 | 可以说明什么 |
| --- | --- | --- |
| [文档工作台](assets/screenshots/studio-writing.jpg) | 本机真实 Electron Studio 窗口，界面显示 v0.1.118；使用 [演示文档](demo-materials/从资料到初稿.md)。右侧输入框有一条待发送指令，Agent 显示未连接 | 文件树、Markdown 文档与 Agent 入口的实际布局和任务准备位置 |
| [内嵌浏览器](assets/screenshots/studio-browser.jpg) | 同一隔离实例，原生内嵌网页实际可见；网页来自 [原创参考页](demo-materials/reference.html)，通过本机 HTTP 加载。Agent 指令尚未发送 | 网页与文档标签页、Agent 入口在同一工作空间的实际呈现 |

截图于 2026 年 10 月 16 日通过原生窗口采集。使用独立 userData 与专用演示工作空间，没有借用真实账号、用户会话、模型凭证或平台业务资料。

原生采集返回 JPEG 字节，因此保留为 `.jpg`；没有重绘界面、替换运行状态或伪造 Agent 输出。系统窗口控件与实际开发版状态一并保留。后续版本升级后，应按实际界面决定是否重新采集，不把这组截图标注为其他版本。

这组截图不证明真实模型执行、网站自动提交、公开发布或远程在线协作成功。文章中对截图的图注已经区分实际界面、演示材料和待发送指令。

## 编辑制作的配图

| 文件 | 类型与用途 |
| --- | --- |
| [横版封面](assets/graphics/cover-wide.png) | 1600 × 900，品牌与核心定位 |
| [协作流程](assets/graphics/workflow.png) | 1600 × 820，协作方式示意 |
| [能力关系](assets/graphics/capability-map.png) | 1600 × 1000，工作空间关系示意 |
| [方形封面](assets/graphics/cover-square.png) | 1080 × 1080，社交媒体独立封面 |
| [介绍图卡](assets/graphics/card-01-introduction.png) | 1080 × 1440，说明产品与工作方式 |
| [界面图卡](assets/graphics/card-02-workspace.png) | 1080 × 1440，在版式中完整放入真实文档截图，未改写截图内容 |
| [上手图卡](assets/graphics/card-03-get-started.png) | 1080 × 1440，说明源码入口、使用条件与开源参与 |

品牌图标直接复用仓库 `resources/icon.png`，副本为 [app-icon.png](assets/brand/app-icon.png)。配图为本地可编辑 SVG，经本地渲染生成 PNG；没有使用生成式模型重建产品界面。

图片尺寸和校验值记录在 [素材清单](assets/asset-manifest.json)。社交媒体可直接取用 `04-social/images/` 中的四张 PNG 副本。

## 公众号精修配图

公众号精修稿使用五张专用配图，共用初稿与其他渠道的图片仍然保留。

| 文件 | 用途与取景 |
| --- | --- |
| [公众号封面](01-wechat/images/cover-v2.png) | 1200 × 675；文字与工作空间关系示意，不是产品 UI 模拟图 |
| [工作台导览](01-wechat/images/workspace-guide-v2.png) | 1200 × 1370；在完整真实文档截图外添加区域编号和说明 |
| [任务输入特写](01-wechat/images/task-detail-v2.png) | 1200 × 860；原文档截图输入区的局部视窗，保留原有指令与控件，指令尚未发送 |
| [浏览器特写](01-wechat/images/browser-detail-v2.png) | 1200 × 1170；原浏览器截图的局部视窗，保留真实标签栏、工具栏与演示页面 |
| [协作分工](01-wechat/images/workflow-v2.png) | 1200 × 1430；竖向协作示意，区分用户与 Agent 的工作 |

局部取景采用 SVG 视窗引用原始 JPEG，未重绘、替换或补写界面文字。完整原图保持原字节与校验值。任务输入特写没有包含顶部状态栏；完整原图中的 Agent 状态为未连接。正文和图注均把该图定位为任务准备，未把它当成模型执行证据。

取景坐标、输入来源和新图校验值记录在素材清单中。逐段文字与取图理由见 [公众号修订说明](01-wechat/paragraph-review.md)。

## 开源社区精修配图

社区版保留公众号版的视觉语言，使用四张专用配图，PNG 旁均保留同名 SVG。

| 文件 | 用途与依据 |
| --- | --- |
| [社区封面](02-open-source/images/cover-v2.png) | 1200 × 675；以源码目录示意配合开源定位，不是产品 UI 模拟图 |
| [真实工作台](02-open-source/images/workbench-v2.png) | 1200 × 1370；完整引用真实文档截图，只在截图外添加说明 |
| [源码职责](02-open-source/images/architecture-v2.png) | 1200 × 1490；依据当前架构说明 renderer、preload、main 与 shared 的职责，不是执行轨迹 |
| [源码上手](02-open-source/images/getting-started-v2.png) | 1200 × 1550；环境版本从 CI 与 packageManager 读取，展示启动与配置顺序，不是命令执行日志 |

真实截图仍保留 v0.1.118 标记、演示文档和待发送指令，没有改成当前版本或模型执行结果。素材来源与校验值记录在清单中，文字取舍见 [社区逐段修订说明](02-open-source/paragraph-review.md)。

## 发布范围

本文件夹交付两套精修稿、两套初稿及本地预览。没有执行平台上传、消息发送、网站部署或公开发布。公众号和其他平台的最终图片裁剪、链接展示与排版，需要在对应发布界面检查。
