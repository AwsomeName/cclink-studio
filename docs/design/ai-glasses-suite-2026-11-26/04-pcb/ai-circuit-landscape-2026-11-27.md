# 近期 AI 电路设计调研｜从已有电路读起

核验日期为 2026-11-27（北京时间）。聚焦已有 PCB/FPC 原理图的讲解、原理图生成、布板和实体验证。热度取 GitHub 当日星标快照；商业产品取官方文档，实验指标取作者论文。星标衡量关注度，单个厂商样板和论文结果各有自己的适用范围。

**最贴近 Studio 的组合是 Flux 的圈图交互、AllSpice DRCY 的原图与手册引用，以及 Seeed 的确定性查线。** 初学者可以直接圈一块问“这里做什么”；工具先找出相关器件、引脚及真实连接，模型再把它们讲成人话。对只有生产资料的 FPC，先解释看得见的焊盘、板边和元件位置；讲信号去向要有同版网表、引脚表或原理图。

## 项目与方案

| 方向与代表 | 输入、用户动作及输出 | 开放性、证据和取舍 |
| --- | --- | --- |
| **已有板上提问 · Flux** | 在原理图、PCB 或三维视图圈位置，用日常语言提问。Markup 向对话提供带标记的当前视图；编辑器另提供元件与网络等工程上下文。官方也列有 Altium 导入流程 | 商业平台，已核产品操作文档。可借鉴“先指给我看，再告诉我它在干什么”。本轮没有上传私有图，也没有验证 Altium 导入的语义完整度。[圈图文档](https://docs.flux.ai/flux/reference/markup-mode) · [工程上下文](https://docs.flux.ai/reference/flux-agent) · [Altium 迁移说明](https://docs.flux.ai/Introduction/flux-to-altium-migration-doc) |
| **在陌生设计中找依据 · AllSpice DRCY** | 从聊天查询器件和连接，结合工程属性与器件手册；评审意见回指原理图位置和手册。2026 年 1 月推出原理图初审，11 月仍有官方说明 | 商业产品。对读板最可借鉴的是同一个答案里能看到“手册说这个器件做什么”以及“图上它实际接了什么”。没有获得其在眼镜板上的误报/漏报数据。[功能文档](https://learn.allspice.io/docs/drcy-ai-design-review) · [发布记录](https://allspice.io/product-updates/introducing-ai-schematic-reviews) |
| **用工具查引脚 · Seeed schematic-analyzer / KiCad MCP** | 按器件、引脚、网络或层级页查设计。Analyzer 支持 KiCad；Cadence 路径需要相应网表及 OrCAD XML。对网络连接可调用解析器，并保留返回的对象 | ai-skills 仓库 MIT；Seeed MCP README 声明 MIT。Analyzer 做了下述本机小实验。适合借鉴检索方式，不能直接当 Altium 二进制解析器。[分析器](https://github.com/Seeed-Studio/ai-skills/tree/main/skills/schematic-analyzer) · [MCP](https://github.com/Seeed-Studio/kicad-mcp-server) |
| **让通用 Agent 操作 KiCad · mixelpixx/KiCAD-MCP-Server** | 连接 KiCad 工具，分组开放只读查询或制造导出；维护者单列了整板理解仍缺的能力 | MIT，约 3,575 星。适合作为“模型可以向工程问哪些问题”的参考；工具数量不代表能解释板级设计意图。[仓库](https://github.com/mixelpixx/KiCAD-MCP-Server) · [维护者的能力边界](https://github.com/mixelpixx/KiCAD-MCP-Server/discussions/112) |
| **用代码描述新电路 · atopile / tscircuit** | 把器件和连接写为可复用的模块；tscircuit 使用 TypeScript/React 风格。模型可以生成结构化设计，再由工具展开、显示、检查和比较修改 | 两个主仓库均为 MIT；GitHub 快照分别为 4,107 和 3,081 星。后续做可编辑教学电路和新模块草案时值得参考。把外协板移到新格式有转换成本，首期读板可保留原源文件。[atopile](https://github.com/atopile/atopile) · [tscircuit](https://github.com/tscircuit/tscircuit) |
| **根据已有设计自动布局布线 · Quilter Project Speedrun** | 从已有电路与约束生成布局候选。团队公开了两块板、843 个元件的 Linux 计算机案例与设计文件入口，并报告首次上电启动 | 商业布局工具，属于厂商披露的实物成果，出现在 2025 年底。它说明已有原理图之后可以怎样加快布板；迁移到狭小镜腿、动态弯折、天线和装壳仍需各自验证。[项目资料](https://www.quilter.ai/project-speedrun/download) |
| **生成、制作、测量 · JARVIS** | 2026-11-19 预印本：作者让机器人、PCB 打印机、贴片设备和示波器完成一次 60 Hz 陷波器实验，报告用时 2 小时 39 分、60 Hz 衰减 50.6 dB，依据测量生成后续修改设计 | 学术实物演示；本次核对论文，未独立复现。它展示了怎样以测量检验设计，覆盖的是指定设备上的一种电路。[作者论文](https://arxiv.org/abs/2611.26503) |

## 模型应按要完成的动作选

| 要完成的动作 | 候选及当前证据 |
| --- | --- |
| 从需求生成可编辑原理图 | 微软 **SchGen** 用约 8,000 对样本微调 gpt-oss-20b，输出可经专用接口转成 KiCad 原理图的 Python 代码。官方仓库与模型卡标 MIT；模型文件列表中可见 adapter_model.safetensors，使用时需要对应基座及工具链。适合生成练习用的小电路；生成代码可以执行，并不能验证真实器件的供电、布线或板子能否工作。[模型卡](https://huggingface.co/microsoft/SchGen) · [文件列表](https://huggingface.co/microsoft/SchGen/tree/main) · [代码](https://github.com/microsoft/SchGen) |
| 从已有工程解释器件和信号 | **通用语言/图文模型 + 确定性查询**。可把开放权重 Qwen3.5-9B 作为本地候选（模型卡 Apache-2.0），与能处理结构化输入的商业模型在相同问题上比较。这里的选型依据应是中文讲解是否清楚、是否如实引用连接、是否在信息缺失时停止；本轮未跑推理或评出胜者。[Qwen 模型卡](https://huggingface.co/Qwen/Qwen3.5-9B) · [PCB-QA](https://arxiv.org/abs/2606.23704) |
| 从扫描图提取标注或连接候选 | **PaddleOCR-VL-1.6** 有开放权重，模型卡标 Apache-2.0，适合读文字和表格。**SINA** 将检测、OCR 与连线解析组合，作者公开代码，PCB 说明包含 Google Cloud Vision 依赖。OCR 可辅助找位置；判断导线交叉是否相连、同名标签属于哪一页，需要独立校验。本轮未部署这两种模型或服务。[OCR 模型卡](https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6) · [SINA 作者仓库](https://github.com/medal-ece/SINA) |

## 哪些数据足以支持首期决策

- **同一个模型，输入差别很大。** PCB-QA 从 8 个开源硬件工程编制了 480 道是非题，涵盖器件连接、手册和仿真。在随机 25% 子集上，论文表 3 的 GPT-5.4 Nano 准确率分别为原理图 PDF 43%、原生 KiCad 导出组合 55%、作者构造的 JSON 组合 88%。后一组还整理了网表及仿真信息；不能把提升全部归功于 JSON 语法。这组实验也没有衡量初学者能否听懂解释。[论文表 3](https://arxiv.org/abs/2606.23704)
- **认出芯片和追对整条网是两件事。** OmniSch 收录 1,854 张真实原理图，考察符号、引脚、网络与几何。作者在论文的真实图像设置中报告，受测多模态模型的最佳网络检测 F1 仅 27.44%。它衡量图片到网络的识别质量；与 PCB-QA 的是非题准确率不可横比。对有 SchDoc 的工作空间，优先使用原生数据有直接依据。[OmniSch 论文](https://arxiv.org/abs/2604.00270)
- **本机做了一个正反对照。** 取 Seeed ai-skills 提交 32a1f21 的原始 Python 解析器和作者公开测试图。GPIO16 标签落在导线上时，查询返回本地标签 GPIO16 和子页引脚 EP_DCn；仅把标签从 (20,20) 移到 (20,25)，同一查询返回空列表。两次命令均成功退出。这个结果只覆盖小型 KiCad 夹具、父页和一个子页引脚别名，没有测试子页内部、真实 Altium 整板或模型回答。[固定版本测试](https://github.com/Seeed-Studio/ai-skills/blob/32a1f21b834bcb08bd273e155d70257dd3d5dbef/skills/schematic-analyzer/tests/test_sheet_pin_alias_resolution.py)

## 回到眼镜板

用户问“声音从哪儿进来”，第一类依据是 U9 的型号、SDIN 的引脚号，以及手册对数模转换的说明。追问“U9 出来的声音在我这块板上接到哪里”，第二类依据必须是当前修订里的导线、网络标签、跨页关系及中间器件。已有资料只确认到哪一脚，就在那一脚结束高亮。若希望了解手中的 FPC 在眼镜里承担哪个环节，只有装配图和制造层时，先带用户找连接器与方向，再指出要向外协索取哪张引脚表。这是本次调研对 Studio 首期范围的判断。商业服务未上传试用私有资料，开放模型未做本机推理，各项目的工程指标不当作本产品验收。
