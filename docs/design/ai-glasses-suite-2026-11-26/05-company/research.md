# 开源经营工具与本地文档识别选型

**本次选择。** 日常工作直接复用 Studio 的业务、售后、账目、发布事务和决策卡。接外部软件从代账或店铺已有导出文件做单向交换。首版只用已有字段表单；文档识别放在人工核对之前，按「原始结构化数据 → PDF 文字层 → 本地识别候选 → 人看原件」处理。无需模型也能完成跟进、确认和交付。

核验日期 **2026-11-26，Asia/Shanghai**。表中带发行号的版本取各官方 GitHub 仓库当时标作 latest 的公开 release，Odoo 另按明确分支核对；模型版本另按发布方模型卡 revision 固定。工具能力与许可证来自原仓库、文档及官方模型卡。本机执行范围单列在下方。公司现行代账软件、平台数据接口、部署合同与真实单据指标尚待业务样本确认。

## 经营工具

| 类别 / 检查版本 | 上游可直接做什么 | 对这家公司的采用决定与代价 | 官方核验 |
|---|---|---|---|
| 会计 · GnuCash 5.17 | 桌面复式记账；CSV 导入向导可选账户、日期与金额列，预览并匹配交易。项目许可证说明主体可选 GPLv2 或 v3，仓内有按文件的差异。 | **数据交换候选。** 代账确实使用 GnuCash 时，由代账把 Studio 导出的现金明细映射到其账户与对方科目。先在其测试账簿导入两条同日同额的记录并确认可区分，再扩大至整月。换成其他代账软件则按实际模板适配。无须把第二本总账随 Studio 分发。 | [仓库和版本](https://github.com/Gnucash/gnucash/releases/tag/5.17) · [许可证原文](https://raw.githubusercontent.com/Gnucash/gnucash/stable/LICENSE) · [CSV 导入手册](https://www.gnucash.org/docs/v5/C/gnucash-manual/trans-import.html) |
| 会计 · Frappe Books v0.36.0 | 面向小企业的独立 Electron 桌面会计软件，使用本地 SQLite，提供发票、付款及财务报表；仓库 AGPL-3.0。 | **暂缓集成，保留独立使用。** 同用 Electron、SQLite 不构成数据库兼容。嵌入其业务逻辑会同时引入另一套记账、备份与迁移。只有代账明确采用它并给出可重复导入模板，才试验文件交换。 | [仓库、功能与许可证](https://github.com/frappe/books) · [版本](https://github.com/frappe/books/releases/tag/v0.36.0) |
| ERP · ERPNext v16.61.0 | 销售订单、交货、销售发票、收款分单据，支持库存和制造；服务端 ERP，仓库 GPL-3.0。 | **适配单据语义，已有 ERP 时交换。** 用店铺/ERP 原订单号、明细行及结算批次回查；库存、制造与履约动作留在原系统。整套部署需要站点、权限及维护，无法为当前一笔直售售后降低录入成本。出现多仓、批次库存或经销商履约需求再选 ERP。 | [发布版本](https://github.com/frappe/erpnext/releases/tag/v16.61.0) · [仓库许可证](https://github.com/frappe/erpnext) · [销售订单手册](https://docs.frappe.io/erpnext/sales-order) |
| CRM · EspoCRM 10.1.4 | 自托管 CRM，处理客户、线索、商机和案例；AGPL-3.0。CSV 支持按实体映射字段、仅新增、仅更新或新增兼更新。 | **保留 CSV 交换，首版暂缓部署。** 对方已使用 CRM 时先以实体 ID 回查，映射业务与等待方。客户同名或不同店铺共用订单号时不得按姓名更新。没有现成 CRM 时沿用本地 customer_cases；多人销售跟进成为实际瓶颈时再评估。 | [仓库](https://github.com/espocrm/espocrm) · [版本](https://github.com/espocrm/espocrm/releases/tag/10.1.4) · [导入选项](https://docs.espocrm.com/administration/import/) |
| 表单 · SurveyJS Form Library v3.2.7 | React 可渲染 JSON 定义的条件字段、多页表单；Form Library 为 MIT。Creator、Dashboard、PDF Generator 有独立开发者许可。 | **可原样复用的上游库，首批不引入。** 售后固定字段沿用 Studio 原表单；若几种产品需要可变问卷，试用 MIT 运行库渲染仓内受控模板，进主进程前再校验，不接受远端脚本/任意表达式。拖拽设计器或 PDF 组件需单独评估。 | [仓库与版本](https://github.com/surveyjs/survey-library/releases/tag/v3.2.7) · [各组件许可](https://surveyjs.io/licensing) |
| 表单 · Formbricks 6.2.3 | 能自托管链接、网站和应用内问卷。核心 AGPLv3；仓库同时包含企业许可目录，Docker 镜像可含依密钥启用的模块。 | **暂缓托管。** 公司已选择直接销售和售后；为一条售后记录额外运营公网采集服务不划算。若使用方已有经授权的调查，先手选导出记录，以来源响应 ID 去重；收集范围、访问和删除由原服务负责。 | [仓库与核心/企业版边界](https://github.com/formbricks/formbricks#-license) · [发布版本](https://github.com/formbricks/formbricks/releases/tag/6.2.3) |

**第二轮对照，Odoo Community。** 另查 Odoo 20.0 公开源码分支及同分支的官方导入文档。社区源码 LICENSE 为 LGPLv3；企业版另行许可，官方法律文档当时的版本标题仍为 19。其导入文档强调保留 External ID，便于更新同一行。由此收紧与 ERPNext 一样的接入条件：若店铺已有 Odoo，可在用户选取的导出文件里保留外部稳定 ID；只给客户名、金额或显示序号时一律列为未匹配。此处核了文件契约，未在本机部署或试导入。暂缓采用完整 ERP，首版保留本地手记与原订单引用。[社区源码许可](https://raw.githubusercontent.com/odoo/odoo/20.0/LICENSE) · [版本许可说明](https://raw.githubusercontent.com/odoo/documentation/20.0/content/legal/licenses.rst) · [导入与外部 ID](https://raw.githubusercontent.com/odoo/documentation/20.0/content/applications/essentials/export_import_data.rst)

**商用与交付边界。** 上表的 GPL、AGPL、MIT 均允许按其条款商用。交付代码时要按所选具体组件履行署名、许可或对应源码等义务；修改后通过网络提供 AGPL 服务还需核查相应源码提供义务。官方付费组件、扩展、托管服务有自己的条款。首版没有把这些程序或付费组件复制进 GPL-3.0-only 客户端。真实文件能否进代账的软件，最终靠字段映射、试导入及代账反馈确认。

## OCR 与文档模型

| 候选和许可证核对 | 对应输入、输出和本机成本 | 决定与淘汰条件 | 官方原件 |
|---|---|---|---|
| **Tesseract**，上游 5.5.4；本机 5.5.3。代码 Apache-2.0，tessdata_fast 语言数据仓另标 Apache-2.0。 | 本地 CPU 支持印刷图像和词框/置信度。PDF 先取文字层或只渲染所需页；表格行列、币种与含税语义需要额外核对。本机已试中文/英文组合。 | **可复用的第一条 OCR 基线**，默认按需启用。适合清晰的金额、日期、短号，不根据置信度自动入账。真实手机照片若大量需要改行或改字，直接留手工入口并对照 Paddle。 | [引擎](https://github.com/tesseract-ocr/tesseract) · [发行版](https://github.com/tesseract-ocr/tesseract/releases/tag/5.5.4) · [语言权重](https://github.com/tesseract-ocr/tessdata_fast/tree/4.1.0) |
| **PP-OCRv6 small 检测 + 识别**，PaddleOCR v3.7.0；代码 Apache-2.0，发布方两张权重卡均标 Apache-2.0。 | 检测文本行再识别，适合中文照片；small_rec 卡标 5.2M 参数，这是识别模块单独的数量。还需本机兼容运行时、检测权重与字典。 | **第一比较候选。** 同一组原图考查框、字、金额与行关系。若相对人工和 Tesseract 没有减少纠错，或离线模型加载开销不合算，不随默认安装包分发。此机未跑该模型。 | [代码版本](https://github.com/PaddlePaddle/PaddleOCR/releases/tag/v3.7.0) · [检测卡](https://huggingface.co/PaddlePaddle/PP-OCRv6_small_det/tree/106c97591b235f607453300d9fc8c1cad1b25488) · [识别卡](https://huggingface.co/PaddlePaddle/PP-OCRv6_small_rec/blob/bd619643acac4b9650c040234da8d944476ee3f1/README.md) |
| **PaddleOCR-VL-1.6**，0.9B 视觉语言模型；运行代码与此具体模型卡各标 Apache-2.0。 | 文档版面、表格、阅读顺序等结构解析，适合密集结算页。模型加版面处理与推理后端需要额外内存和安装空间。 | **暂缓常驻，仅做疑难页离线试验。** 只有输出可定位到原页和真实单元格且纠错时间下降时才试接。生成的 Markdown 表格或推测补齐的缺失值不能直接生成财务依据。本机未跑。 | [官方代码及部署](https://github.com/PaddlePaddle/PaddleOCR) · [权重、架构与使用说明](https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6/blob/132c45f52c0a26ed5a6b2f6bd8e3985794cc27dd/README.md) |
| **Docling / Granite Docling 258M**，Docling v2.153.0 代码 MIT，IBM 模型卡 Apache-2.0。 | 将整页解析为结构化文档，包含表格、布局和阅读顺序；IBM 把中文标为实验性。Docling 可搭配多个引擎，每项权重需要单独检查。 | **对照模型，暂缓进入中文票据默认链。** 小模型能否在此设备减少行错位要实测；中文字段、长表跨页及负数是重点。未下载、未运行，本地峰值内存未知。 | [工具及许可证](https://github.com/docling-project/docling) · [版本](https://github.com/docling-project/docling/releases/tag/v2.153.0) · [发布方模型卡](https://huggingface.co/ibm-granite/granite-docling-258M/blob/982fe3b40f2fa73c365bdb1bcacf6c81b7184bfe/README.md) |

开放权重一栏记录发布方对具体文件的标注，可按相应条款商用；不据此推定训练集开放、所有可选权重同许可或中文财务识别准确。适配前固定模型 revision、核查随包依赖和 NOTICE、验证离线启动、记录资源占用。现有 package 中有 pdfjs-dist，可先调查原 PDF 预览的文字层接口，禁止从普通渲染器绕过文件授权；本轮未把它认定为现成的结构化票据解析器。

## 在这台 Mac 得到了什么结果

Apple M1，16 GiB，macOS 26.5.1。本机预装 Tesseract 5.5.3 的语言清单只有 eng、osd。研究时仅向临时目录取官方 tessdata_fast 4.1.0 的 chi_sim，配合已有 eng 运行，权重未写入应用。两次均由 CPU 识别 PNG，单次命令耗时包含启动。输入是六行自制中文结算单，数字含千分位、小数和订单号前导零。

| 输入条件 | 日期 / 订单号 / 三个金额 | 费用名称 | 单次耗时 |
|---|---|---|---:|
| 宋体 42 px，840 × 470，白底 | 五项完全一致 | 「镜腿打样」「运费」均一致 | 0.280 秒 |
| 同图半宽、旋转 1.7°、轻度模糊 | 五项仍一致 | 「镜腿打样」读成 BURBAT EE，「运费」读成 JER，日期标签也误读 | 0.224 秒 |

同一来源的两种处理只能说明一个失败路径。系统应让人同时看到候选字段和原行，允许舍弃候选而保留原件。耗时没有重复采样，不能当作产品性能指标。完整原文、输出、语言权重指纹与运行参数可复查。[本机实测记录](ocr-check.json)

**下一次比对怎么决定是否投入。** 由公司选有权处理的脱敏实物，至少覆盖清晰票据、倾斜/折痕、跨行退款、重复金额、盖章遮字和跨页结算。保留 PDF 文字层及全手工录入作为两条对照，同一批交叉测试 Tesseract 与 PP-OCR，再用复杂表格子集测试两个文档模型。两人独立校对金额、币种、方向、日期、前导零、行配对与页码；分输入类别记录完整匹配率、缺失/错配数、人工纠正时间、中位与 P95 延迟、冷启动、峰值内存。识别到错误或缺失仍能原样导出凭证；即使识别完全正确也须由人确认流水。首轮采用条件为无外传、可撤销、每个可采纳字段可追到原文，而且该公司用其真实资料核对比手工省时。源文件结构已经稳定时优先做确定性解析。
