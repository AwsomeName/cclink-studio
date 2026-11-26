# 外壳工具选型与本机复核

公开资料核验于 **2026-11-26（Asia/Shanghai）**。下表给出核对过的发布、仓库、文档与模型卡。公开版本、这台 Mac 的实际内核版本及仓库原有应用验收分别列出。实验在本机进行，工程 STEP 未送至外部服务。

## 先判断手里拿的是什么

- **STEP 的交付内容取决于文件与导入器。** 可能是带解析曲面和拓扑的 B-Rep、开壳/曲面、装配树、面片化几何或它们的组合。基础 STEP 翻译器处理几何、拓扑和装配；XDE 另处理名称、颜色、层、属性等。产品结构中的实例位置可用于对齐，仍需实际配合关系、装配顺序、公差与工况。先看对象、solid、有效性、表示来源和单位，再开放操作。[OCCT STEP 翻译器与 XDE](https://dev.opencascade.org/doc/overview/html/occt_user_guides__step.html)
- **参数历史留在原生源。** 原设计的 FCStd 特征树、草图约束或 Python 模板可用来重算。普通供应商 STEP 导入后的几何可以再做受限操作，但无法凭几何唯一还原供应商的草图顺序、基准命名、设计意图或公差。交付者若提供带 PMI 的资料，需验证当前导入器读了哪些属性。Studio 的修改快照只描述本轮操作。[FreeCAD 源码与功能](https://github.com/FreeCAD/FreeCAD) · [CadQuery 交换格式说明](https://cadquery.readthedocs.io/en/latest/importexport.html)
- **网格、数字核验和实物试装各回答不同的问题。** STL/OBJ/显示用三角网格适合看外观；网格采样密度、单位和曲面近似会影响读数。封闭实体、BOP、截面尺寸提供特定数字证据；静态零干涉仍遗漏插拔路径、折叠全行程、卡扣顺应、FPC 回弹和打印变形。所有缺测项应回到图纸或样件。[build123d 交换格式表](https://build123d.readthedocs.io/en/latest/how_to/import_export.html) · [Studio 历史门禁及警告基线](../../../features/eyewear-step-ai-editing-development-plan.md)

## 工具怎么选

| 工具与核对版本 | 适用能力与取舍 | Mac、代码许可证与采用决定 |
| --- | --- | --- |
| **FreeCAD 1.1.4 / FreeCADCmd** | 原生参数文档适合手动重设计。首轮导入单实体 STEP，以固定适配器做截面插入、导出、重读与布尔检查。有完整桌面入口供结构人员复量。供应商交付的 STEP 不附原生特征树。 | 已实测 arm64；官方同版有 arm64 与 x86_64 安装包。标记 1.1.4 的 LICENSE 文件为 LGPL 2.1 文本。选择用户已有或自行安装的本地后端；暂不在 Studio 分发另一份 CAD。Intel 资产存在，本轮未在 Intel 上执行。[官方版本和安装包](https://github.com/FreeCAD/FreeCAD/releases/tag/1.1.4) · [该版本许可](https://github.com/FreeCAD/FreeCAD/blob/1.1.4/LICENSE) |
| **Open CASCADE Technology** | 曲面拓扑、STEP/XDE、布尔、距离与离散化的底层能力。Studio 的 OCCT 预览只向显示层输出网格；启用预览后端本身不会取得编辑入口。后续只读装配可评估 XDE，不同时维护两套 STEP 写入器。 | 上游发布 8.0.2；本机 FreeCAD 内嵌 OCCT **7.8.1**。行为以被调用的实际二进制为准。社区 OCCT 为 LGPL 2.1 加项目例外；商业附加组件须分别核对。选现成 FreeCAD 调用，推迟自编原生模块。[上游发布](https://github.com/Open-Cascade-SAS/OCCT/releases/tag/V8_0_2) · [许可](https://github.com/Open-Cascade-SAS/OCCT/blob/master/LICENSE_LGPL_21.txt) · [例外](https://github.com/Open-Cascade-SAS/OCCT/blob/master/OCCT_LGPL_EXCEPTION.txt) · [Studio 预览实现](../../../../src/main/cad/occt-converter.ts) |
| **CadQuery 2.8.0** | Python/OCP 参数脚本、STEP 输入输出和装配导出，适合自有支架、孔距变体和夹具。自家脚本是可重建源；输入 STEP 提供形体，不会产生原历史。在本轮重复一套基于相似内核的生产编辑链，增加装包与数值回归。 | Apache 2.0；OCP 等依赖各有许可。官方说明有 macOS 二进制轮包及 conda 路径，须按具体 Python/架构锁定。备选作受审模板，当前未本机安装或试跑。[发布](https://github.com/CadQuery/cadquery/releases/tag/v2.8.0) · [官方仓库及安装/许可](https://github.com/CadQuery/cadquery) · [装配和交换](https://cadquery.readthedocs.io/en/latest/importexport.html) |
| **build123d 0.13.0** | Python 构建器/代数建模、STEP 导入导出及有层级的零件；适合从已知尺寸新建参数件或关节示意。运动对象仍依赖人为指定关节轴和配合。对现有未知壳体，没有消除重新选基准与验证的成本。 | Apache 2.0；该 tag 指定 Python ≥3.11 且 <3.15、cadquery-ocp-novtk 8.0 系列。另设环境，不能把该 OCP 直接塞入当前 FreeCAD。候选与 CadQuery 二选一；本轮未验证 Mac 轮包组合。[发布](https://github.com/gumyr/build123d/releases/tag/v0.13.0) · [依赖](https://github.com/gumyr/build123d/blob/v0.13.0/pyproject.toml) · [仓库及许可](https://github.com/gumyr/build123d) · [交换说明](https://build123d.readthedocs.io/en/latest/how_to/import_export.html) |
| **OpenSCAD** | .scad 文本 CSG 与二维拉伸适合参数化小夹具并输出打印网格。官方稳定版资料列出的常用三维交换为 STL/OFF；此链路缺乏本任务所需的既有 STEP 精确曲面往返、装配关系与固定区域证据。暂不做壳体编辑后端。 | GitHub latest 稳定标签 openscad-2021.01；官网另列开发版/候选，不混用功能说明。GPL v2 系列及 COPYING 中的例外；提供 macOS 分发，但本机未跑。可在后续打印定位治具时独立使用。[官方仓库/发行](https://github.com/openscad/openscad/releases/tag/openscad-2021.01) · [建模与格式](https://openscad.org/about.html) · [Mac 包](https://openscad.org/downloads.html) · [许可](https://github.com/openscad/openscad/blob/openscad-2021.01/COPYING) |
| **Blender 5.3 系列** | 网格、修改器、材质、动画和渲染适合整机爆炸图、造型和宣传。对 STEP 转网格再导入的模型，几何节点/修改器记录的是后续造型过程；不能作原机加工曲面、孔销配合或验收量测凭据。排除出首轮精确改版。 | 官方有 macOS 构建，具体机型依官方要求；本机未跑。代码 GNU GPL，第三方附带资源各自有许可。可从确认版本导出可视化副本给视频专题。[官方源代码镜像](https://github.com/blender/blender) · [5.3 源码](https://github.com/blender/blender/tree/v5.3.0) · [I/O 模块](https://github.com/blender/blender/tree/v5.3.0/source/blender/io) · [许可](https://github.com/blender/blender/blob/v5.3.0/COPYING) · [Mac 要求](https://www.blender.org/download/requirements/) |

上述开源软件可依各自条款用于商业设计；交付工具二进制、改版源代码、元件模型、图纸或生成的数据分别适用相应授权。首轮只调用本地已有工具。本机检测范围为标准 Applications 目录、CLI 与默认 Python 导入，不将未探测到推断为整台机器所有环境都未安装。未比较各工具的运行速度。

## 外部零件、板文件与 AI 辅助

**优先选择实际料号和图纸。** PCB 负责人可从 KiCad 导出板体加所装配器件的 STEP，记录板修订、TOP/BOTTOM、原点选项、变体、忽略 DNP 与缺 3D 模型清单。board-only 导出只能核对板体。KiCad 官方 STEP/VRML 库可提供通用零件参照；库本身为 CC BY-SA 4.0 加电子设计及其输出的特定例外，再分发独立模型需看原条款。厂商 CAD/图纸另计，下载可用不等于允许打包或转售。Hirose BM20 系列演示为何要按公母具体料号、配对高度、图纸版本查证；不假定方案中的 J1 使用该系列。铰链优先取供应商左右件、销与止挡图；只有网格或公开眼镜壳时可演示外观，尚缺有授权且与真实样件相符的铰链模型，不预置替代品。[KiCad STEP 导出选项](https://docs.kicad.org/9.0/en/cli/cli.html) · [KiCad 模型仓库](https://gitlab.com/kicad/libraries/kicad-packages3D) · [KiCad 库许可](https://www.kicad.org/libraries/license/) · [Hirose BM20 官方系列](https://www.hirose.com/product/series/BM20)

| 路线 | 输入、输出与权利依据 | 本地适用性与决定 |
| --- | --- | --- |
| **现有 Studio Agent + 固定几何程序** | 从自然语言及已授权的最少参数提出操作快照。FreeCAD 接收经过校验的数据，只运行内置脚本。CAD 软件开源与 Agent 底模权利各自独立；启动于本机的 Agent 后端不能证明权重开放或全部推理离线。 | 选为首轮规划方式；保存与回看证据可手工进行。未知截面、缺最坏公差或变换时先补材料。历史仓库有应用内验收，本轮未再调用外部模型。[固定适配器](../../../../src/main/cad/freecad-section-insert-script.ts) · [工具确认与原验收](../../../features/eyewear-step-ai-editing-development-plan.md) |
| **CAD-Coder（gudo7208，NeurIPS 2025）** | 英文文字 → CadQuery Python，侧重新模型合成。模型卡标 Apache 2.0，发布了四个权重分片，基型 Qwen2.5-7B-Instruct。作者代码仓库 README 也声明 Apache 2.0；当日仓库根目录只有 README 与推理脚本。许可允许依条款商用，不担保生成几何或第三方零件权利。 | 可作为离线设计评估候选，仅产建议/模板草案，人工审阅后在隔离评估环境比较。Mac 内存、MPS 支持、推理时延、中文尺寸正确率均未测；主线不可执行模型生成脚本。排除“用聊天替代读回核验”。[作者仓库](https://github.com/gudo7208/CAD-Coder) · [模型卡与权重](https://huggingface.co/gudo7208/CAD-Coder/tree/958288771567413ff8688d49e43db7ccc21980d0) · [固定模型卡](https://huggingface.co/gudo7208/CAD-Coder/blob/958288771567413ff8688d49e43db7ccc21980d0/README.md) |
| **CAD-Recode v1.5** | 点云 → 推测的 CadQuery 草图/拉伸程序，适合研究形状重建；扫描不会给出供应商精确约束。公开代码许可与该作者发布权重均为 CC BY-NC 4.0；开放下载不赋予本公司的商业部署权限。 | 排除公司产品和商业样件流程；未运行或下载权重。即便另获许可，仍要单独验证单位、拓扑、特征和误差。[代码与许可](https://github.com/filaPro/cad-recode/blob/main/LICENSE.md) · [固定权重卡](https://huggingface.co/filapro/cad-recode-v1.5/blob/765e8cc315a1a77bd8c69ccd0b403bad20ce35e8/README.md) · [作者论文](https://arxiv.org/abs/2412.14042) |
| **普通参数提取（例 Qwen2.5-Coder-7B-Instruct）** | 从已同意提供的文字中抽轴、方向、mm、固定端并标缺项。该指定权重有 Apache 2.0 许可；数值、单位、左右方向仍须结构化校验及人确认。 | 可按既有 Agent 能力做小范围对照；初版不装第二套模型运行时。没有在这台 Mac 上做推理或计时。[官方模型卡](https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct) · [权重许可](https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct/blob/dcc04bb77301e6368aa24a609c6ea496b70503e8/LICENSE) |

若后续需要决定是否用新模型，先建立由机械负责人标注的盲测集：正/负向、英寸换算、左右镜像、含糊截面、错板版次、要求移动固定端各有案例。比较参数逐字段正确率、必要澄清率、违规提议率和可接受建议所需总人工时间。评估对象只获得脱敏规格；损及固定端的提议一次也不能进入写入链。没有实测数字前，不用论文分数代替本机可交付性。

## 本机实验与历史证据各覆盖到哪一步

环境为 macOS 26.5.1 / arm64。执行本地 FreeCADCmd 的 --version 返回 **1.1.4，revision 20260928**，在同一进程查询 Part.OCC_VERSION 得到 **7.8.1**。通过 FreeCAD CLI 和既有固定 Python 适配器做下列实验，未重跑 Electron、MCP 授权或工厂加工。两份工程样本只读；合成件及临时结果在本专题临时子目录用毕清理。

| 实验 | 操作与读数 | 对首版的约束 |
| --- | --- | --- |
| 历史左镜框 STEP | Import.insert 后得到 1 个形体对象、1 solid，闭合且 isValid。193 个面含 114 个平面、48 个圆柱面、30 个样条面、1 个环面。B-Rep 包围盒 148.1735 × 42.9023 × 50.5921 mm。 | 仓库曾展示该模型的预览网格约 148.17 × 41.06 × 50.59 mm，Y 与实体读数的差别足以误导选型。本次未重跑该件 BOP；历史结果记录 186 条基线警告。[既有实物文件的应用验收](../../../features/eyewear-step-ai-editing-development-plan.md) |
| 镜腿连接件的 faceted-brep STEP | 文件含 MANIFOLD_SOLID_BREP 标记。现行适配器按非空 Shape 对象统计得 10，包含容器/坐标几何，不能解读成 10 个零件。两个单 solid 对象各有 1,308 个平面，组合形体含 2 个 solid。原规划确实拒绝，原因为要求 1 个 STEP shape object，实际 10 个。 | 先辨识“装配实例”和“面片装成的实体”。该文件不能用原适配器直接切；语义孔径、销轴、连续圆柱配合需图纸或解析实体证据。 |
| 受限改版可行性 | 创建 80 × 12 × 7 mm 槽壳，减去从 (8,1,1.2) 开始的 54.2 × 10 × 7 mm 槽，写入合成 STEP。调用仓库固定适配器先 plan，再 modify，X=42 截开，min 固定，正向插入 1 mm。两侧各 1 solid，1 接口面、26 mm²。输出回读 81 × 12 × 7；源/输出 BOP 均 0，保护带 0.05 mm，固定区域双向差 0 mm³，原 SHA-256 前后一致。 | 在 y=6、z=4 上沿 X 求交：A 命中内壁/外端 62.20/80.00 mm，B 命中 63.20/81.00 mm。板尾 X=62.00 为示例假定值，从而 A/B 名义净空 0.20/1.20。证明特定槽形的截线变化；未建模 J1/H1/真实曲面镜腿。 |
| 零距离反例 | 原点处 8 × 2 × 2 mm 体与 2 × 2 × 2 mm 体，后者起点 X 依次为 8.4、8.0、7.8。distToShape 分别 0.4、0、0 mm；common().Volume 分别 0、0、0.8 mm³。 | 对实心零件，零距离既可能是合法接触，也可能是有体积的交叠。布尔失败或仅有开壳时显示未知；真实装配中先标出设计允许的接触对。 |

本轮作图后的核对包括 1500 × 860 桌面图、窄窗重排、基线/副本切换、试装退回与回到尺寸对照。界面为本地 HTML 的真实 PNG 渲染；附图的回执内容和完整装配示意均为虚构，不作为样机验收结果。
