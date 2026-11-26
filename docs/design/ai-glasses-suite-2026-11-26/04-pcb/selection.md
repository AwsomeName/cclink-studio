# 工具、模型与商业使用选择

核验于 **2026-11-26，Asia/Shanghai**。版本取作者当日公开发布页、规范及模型卡。团队使用、将程序装进 Studio 安装包、重新分发第三方封装/STEP/SPICE 模型分别判断。初期采用本地外部工具，不把第三方程序或权重随 Studio 分发。

## 选型表

| 候选及证据 | 适合本团队的任务 | 许可、集成成本与决定 |
| --- | --- | --- |
| **KiCad 10.0.8 / kicad-cli**。公开稳定发布、GUI 和 CLI 文档；本机未运行 | 自有源的原理图、布板、ERC、DRC、图板对照、BOM/坐标/Gerber/钻孔/STEP 输出。团队原生编辑，Studio 触发确定性检查 | **主选源设计后端。** 主体代码 GPL-3.0-or-later，含其他组件；官方库 CC-BY-SA-4.0 有电子设计和派生输出例外，可用于商业闭源板。第三方库逐项保留来源。一个原生后端即可覆盖主要动作。[仓库](https://gitlab.com/kicad/code/kicad) · [稳定发布](https://www.kicad.org/blog/2026/10/KiCad-10.0.8-Release/) · [CLI](https://docs.kicad.org/10.0/en/cli/cli.html) · [代码许可](https://www.kicad.org/about/licenses/) · [库许可](https://www.kicad.org/libraries/license/) |
| **Altium Designer / altiumts 0.0.95**。后者为 Studio 当前锁版；本机用现有解析链读五份真文件 | 既有客户源的只读浏览。原作者可使用 Altium 工程、原生规则及 OutJob 出具同版报告、制造与装配输出 | **保留兼容，不做写回。** Designer 是商业产品，原生编辑及生成由持有相应许可的一方承担。altiumts 解析器 MIT，可按条款用于商业软件；其序列化能力不等于 Studio 获得写回或格式等价证明。KiCad 项目管理器可从 .PrjPcb 导入新工程，列为独立迁移路线。[解析器仓库](https://github.com/tscircuit/altiumts) · [Altium OutJob](https://www.altium.com/documentation/altium-designer/preparing-for-manufacture/output-jobs) · [KiCad 工程导入](https://docs.kicad.org/10.0/en/kicad/kicad.html#_importing_a_project_from_another_eda_tool) |
| **LibrePCB 2.1.1 / librepcb-cli**。官方稳定版；本机未运行 | 从原生 .lpp 工程运行 ERC/DRC 和 Output Jobs；同一 CLI 可做无人值守复现。KiCad 库导入有独立文档 | **客户已有 LibrePCB 源再接。** 开源 GPL-3.0 系列，内部商业使用可行；库与供应商素材各自授权。并行维护第二套工程、库、规则到 UI 的映射，首期没有相应实样收益。库导入不能证明 Altium 工程无损互通。[仓库](https://github.com/LibrePCB/LibrePCB) · [2.1.1](https://github.com/LibrePCB/LibrePCB/releases/tag/2.1.1) · [CLI](https://librepcb.org/docs/cli/) · [原厂 CLI 示例](https://download.librepcb.org/releases/2.0.1/librepcb-documentation-2.0.1.pdf) |
| **内置 Gerber 预览 + gerbv 2.13.0**。本机独立跑过 macOS arm64 官方包 | 复用现有轻量单层和轮廓候选；gerbv 独立读 RS-274X、Excellon、CSV 放置文件，离线输出图片，用于叠层参照 | **选为制造层独立对照与第二期渲染候选。** 上游声明 GPL v2，包中还有其他许可。首期不链接 libgerbv 或捆绑其 GTK 依赖。两套真文件可生成图，X3 属性、柔板规则、宏与负片仍要逐项验；输出截图没有电路规则语义。[仓库及许可](https://github.com/gerbv/gerbv) · [2.13.0](https://github.com/gerbv/gerbv/releases/tag/v2.13.0) |
| **KiCad GerbView / Ucamco**。文档及测试档，本机未跑 GerbView | 用户已有 KiCad 时用 GerbView 交叉打开 Gerber、Excellon 和测量；Ucamco 规范、XNC、Job、X3、测试图校对文件语义 | **本地 GerbView 作第二观察者，Ucamco 作格式基准。** 规范发布不等于实现授权或板厂 DFM。参考网页只用公开夹具，私有图不上传。X2 的层/网络属性、X3 的器件信息、Job 的叠层与工艺均以实际出现字段为准；Gerber 导出 PCB 的有限几何不恢复完整源工程。[GerbView](https://docs.kicad.org/10.0/en/gerbview/gerbview.html) · [Gerber 2026.05、XNC 2021.11 和测试档](https://www.ucamco.com/en/gerber/downloads) · [Job](https://www.ucamco.com/en/gerber/gerber-job-file) |
| **PyGerber 2.4.3**。公开源码，本机未跑 | Python CLI/API 做 X2/X3 图层解析和渲染，适合把可疑宏和极性做小样对照 | **备选，不做首期唯一 CAM。** MIT 源码，部分测试素材许可独立；仓库说明依据 2024.05，而规范已更新到 2026.05。独立钻孔覆盖、2026 新语法和桌面 Python 依赖需专项验证。[仓库](https://github.com/Argmaster/pygerber) · [发布](https://github.com/Argmaster/pygerber/releases/tag/v2.4.3) |
| **KiCad 原生命令 / Jobsets 与 KiBot 1.9.1**。文档对照，本机未执行 | 固定命令适合单次复核；复杂既有配置可用 KiBot 批量导出制造图、BOM、装配文档 | **先直接调用 CLI，已有受控 CI 配方再考虑 KiBot。** KiBot 为 AGPL-3.0，部署为对外服务或分发修改版要单独评估义务。配置、插件、外部命令和依赖增加复现与权限成本。首期不自动运行入库脚本。[KiCad CLI](https://docs.kicad.org/10.0/en/cli/cli.html) · [KiBot 仓库](https://github.com/INTI-CMNB/KiBot) · [1.9.1](https://github.com/INTI-CMNB/KiBot/releases/tag/v1.9.1) |
| **ngspice 47**。官方发布与手册，本机未跑 | 针对有网表、器件模型和激励的局部电路做 DC、AC、瞬态。适合一次电源负载变化或音频滤波响应试验 | **按需仿真。** 主体 Modified BSD，个别目录含 LGPL、MPL、GPL 等，器件宏模型另行许可。缺模型、引脚映射、工作点或不收敛单独报告。不能用波形推断镜腿天线性能、整机 EMC 或 FPC 寿命。[发布](https://ngspice.sourceforge.io/news.html) · [手册](https://ngspice.sourceforge.io/docs.html) · [源码与分项许可](https://github.com/imr/ngspice/blob/master/COPYING) |

### KiCad 适配的实际契约

- 在本机可信安装探测版本及子命令帮助，检查源修订、规则、项目内外库引用和装配变体。在暂存副本运行。ERC 用 **sch erc**，DRC 用 **pcb drc**。10.0 两者支持 JSON、严重度、豁免及按违规退出；带 **--exit-code-violations** 时 5 表示发现违规。0 仍要核完整报告、覆盖范围与输入签名；异常退出、超时、旧报告或 JSON 不可解析单独显示为运行失败。[KiCad CLI](https://docs.kicad.org/10.0/en/cli/cli.html)
- 配对工程才启用 **--schematic-parity**；检查要点包括未连接、铜间距、孔与板边、层间/网类规则和豁免。记录铜区是否重铺，检查不向原件传 **--save-board**。导出使用 **pcb export gerbers / drill / pos / step** 和 **sch export bom**。不同子命令支持的变体与原点参数分别探测；记录输出源和 DNP 选择。STEP 缺 3D 库时保留“器件未建模”清单。[官方参数表](https://docs.kicad.org/10.0/en/cli/cli.html)
- Altium 导入时，比较原生图纸页/层叠、封装、引脚—网络映射、差分对、规则/禁布区、铜皮、开槽、尺寸、装配变体及 OutJob 输出。只有通过预定的实物和制造基准才可为特定板批准迁移。其余继续原生维护或只读查看。[KiCad 导入说明](https://docs.kicad.org/10.0/en/kicad/kicad.html) · [Studio 既有验收](../../../testing/altium-readonly-preview.md)

## 开放模型与确定性检查

| 候选 | 可核的开放物和商业条件 | 产品决定与尚缺证据 |
| --- | --- | --- |
| **PaddleOCR-VL-1.6，0.9B** | 作者发布可下载权重，模型卡标 Apache-2.0；PaddleOCR 工具代码独立公开。商业使用按相应许可，重新分发保留许可和通知。上游文档任务有指标 | **图片助读首选试验。** 针对外协扫描装配图、BOM 表头输出文字和框，保留页码、区域、原文、候选与修订；已有可解析 CSV 优先直接读。眼镜小字、竖排 Pin 1、反色及本机推理速度均未实测。[模型卡](https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6) · [代码](https://github.com/PaddlePaddle/PaddleOCR) |
| **Qwen3.5-9B** | 官方图文模型卡提供后训练权重及配置，标 Apache-2.0。权重开放不等于全部训练数据开放。商业落地另核推理框架、量化来源与权重修订 | **可选本地解释器。** 把装配图中的指示与结构化检查报告关联，要求引用文件、行或裁图；对左右镜像、旋转零点和相似位号允许弃答。本机未加载权重，无眼镜板数据上的正确率、显存或延迟结论。当前 Studio 未据此获得通用本地模型后端。[模型卡](https://huggingface.co/Qwen/Qwen3.5-9B) |
| **Qwen3.8-27B** | 新一代图文开放权重，官方模型卡标 Apache-2.0，团队仓库列出了 2026-08 公开发布记录 | **作为较大模型的离线对照，不设为默认依赖。** 同一精度下仅参数存储需求已高于 9B；尚无本机延迟或小字识别实测。只有在相同人工真值上显著减少错判且机器可承受时才替换。[官方仓库](https://github.com/QwenLM/Qwen3.8) · [模型卡](https://huggingface.co/Qwen/Qwen3.8-27B) |
| **SINA 原理图图像转网表** | 研究组代码 MIT，使用检测、OCR 和连线解析；PCB 流程说明涉及 Google Cloud Vision。未确认每个检测权重、训练素材和服务都覆盖本产品的商业部署 | **不入生产链。** 可用公开图做研究，暂不用于私有装配图或电气签核。少一个结点、看错交叉线都能改变网表；只能与带真值的图逐网对照。[作者仓库](https://github.com/medal-ece/SINA) · [许可](https://raw.githubusercontent.com/medal-ece/SINA/main/LICENSE.txt) · [作者论文](https://arxiv.org/abs/2607.01609) |
| **解析器 + 工程师** | 无推理权重。Studio 当前有表格解析、PNG/SVG 预览及可选 CAD 路径 | **首期默认。** 明确源格式与输入指纹，产生可重算的结果。商业生产仍需要工厂工艺、获准使用的元件数据和实物验证。模型未安装时所有首期动作可独立执行。[现有硬件文档](../../../features/hardware-workspace.md) |

阶段性评测应由硬件工程师留出人工金标准。按板和修订分割样本，不能让同一 PDF 的近重复页跨入评测。分别统计位号/面别/角度字段的完全命中与弃答、错误却自信的次数、证据框命中、页耗时和峰值内存。首轮至少覆盖正反面、镜像、低分辨率、DNP 与相似字符。对任何关键字段误读，只开放人工逐项确认；没有经过同意的离线推理环境则关闭模型入口，继续原生图纸和表格复核。
