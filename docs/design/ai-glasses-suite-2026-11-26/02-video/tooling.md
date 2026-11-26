# 工具、模型与运行路径

核验日期 **2026-11-26（Asia/Shanghai）**。下面列出可独立复查的上游项目或具体 checkpoint。版本号用于复现本次判断。上游 README 的显存下限只适用于其给定命令；本表的 CPU、显存和许可条件以各行上游资料为依据；目标设备未经验证的路径单独注明。

## 剪辑、时间线、渲染

| 候选 | 能力、中文与运行环境 | 分发条件 | 本专题选择 |
|---|---|---|---|
| Kdenlive 26.08.3 | Qt/MLT 桌面非线性剪辑，多轨、嵌套序列、代理媒体、字幕、语音转文字；有 macOS 版。字幕能力与具体模型的中文精度须分别评价 | GPL 桌面程序 | 作为人工精剪出口和交互标杆。团队需要逐轨关键帧、精确遮罩时交剪辑师；首轮导出原素材、SRT 与成片就能交接。整套嵌入会引入第二个工程文件和不同预览引擎。[KDE 手册](https://docs.kdenlive.org/en/getting_started/introduction.html) · [版本公告](https://kdenlive.org/news/) |
| Shotcut 26.11.15 | 跨平台 Qt/MLT，可离线剪切、代理/低分辨率预览、编码导出；官方说明 GPU 编码和整套滤镜运算是两回事 | GPLv3；FAQ 明确允许商业用途 | 低成本外部复核工具。用同一素材核对定格、裁切与代理失真，免去把另一套编辑器打包进 Studio。[官方版本](https://github.com/mltframework/shotcut/releases/tag/v26.11.15) · [官方 FAQ](https://shotcut.org/FAQ/) |
| MLT 7.42 | producer/playlist/tractor/consumer 可组织多轨、滤镜、预览和输出。原生模块、音频输出、Qt/FFmpeg 版本需匹配 | 框架 LGPL-2.1，melt 与插件按各自许可 | 延后。只有受限场景模型在真实交互中持续达不到精剪需求时，才用同一工程快照比较 MLT 预览延迟、内存、分发清单。[代码与版本](https://github.com/mltframework/mlt/releases/tag/v7.42.0) · [模块版权政策](https://github.com/mltframework/mlt_web/blob/master/CopyrightPolicy.md) |
| OpenTimelineIO | 表达剪点、媒体引用、source range、轨道、时间基与转场；适合不同编辑工具交换决策。工具对滤镜、字幕、音量的还原程度各异 | Apache-2.0 开源 API 与格式；每个 adapter 单独核对 | 未来**只导出**受支持的剪点与引用，同时列出丢失的字幕样式、混音等。它不携带媒体、不执行编码。首版用整数帧及现有场景保存，可先省去 Python/C++ 依赖。[ASWF 仓库](https://github.com/AcademySoftwareFoundation/OpenTimelineIO) · [数据模型](https://opentimelineio.readthedocs.io/en/latest/) |
| FFmpeg + ffprobe + libass | 软件编码、裁切、缩放、帧率与声音归一、烧录中文字幕、复用封装。中文质量还取决于字体覆盖及断行；libass 负责排版。官方 9.0 分支 9.0.2 | 核心 LGPL-2.1-or-later；启用 libx264 等 GPL 部件改变构建许可，启用 nonfree 可能使构建不可再分发。H.264/AAC 相关专利与版权许可分开核查 | **采用现有外部运行时，先用 libx264/AAC**。固定 ffprobe 与 FFmpeg 配对，运行短带中文字幕的探针。安装包后续分发另核来源、构建参数、源码/通知、许可证、签名、字体授权。Homebrew 能执行不等于正式包可随附。[版本与源码](https://ffmpeg.org/download.html) · [滤镜](https://ffmpeg.org/ffmpeg-filters.html) · [官方许可说明](https://ffmpeg.org/legal.html) |
| 硬件编码 | macOS VideoToolbox 或 NVIDIA NVENC 是编码后端。滤镜、字幕、色彩转换仍要分别测量；Mac 的统一内存与 NVIDIA 专用显存不可直接换算 | VideoToolbox 为 Apple 系统框架；实际 FFmpeg 构建、驱动及编码专利另核 | 优先衡量终片画质和预览延迟。P2 可比较硬编预览，同一帧数、字幕、音频和色彩条件下与软件输出盲评；硬编失败回到已验证的软件路径。[Apple VideoToolbox](https://developer.apple.com/documentation/videotoolbox) · [FFmpeg 编码器](https://ffmpeg.org/ffmpeg-codecs.html) |

**工程保存语义。** Studio 保存不可变素材引用、镜头出入点、声音引用、字幕 cue 与参数。预览代理和终片都从同一快照编译。交给 Kdenlive/Shotcut 精修后的 MP4 可作为外部交付版本重新导入，记录源工程和作者。首版不承诺第三方 XML 往返还原。

## 中文语音

| 路径 | 模型、运行环境、许可 | 适合程度与取舍 |
|---|---|---|
| 真人口播 + 手动字幕 | 导入自录 WAV/M4A，保留说话人和使用范围；本机无模型也能工作。音色、口音、型号读法由团队决定 | **首个用户闭环**。用实际录音时长定剪点，人工听写/改字和敲入出点。现场实录、后配解说分别标注。 |
| Whisper + whisper.cpp | OpenAI Whisper 多语权重与代码 MIT；whisper.cpp 为 MIT 推理实现，支持 Apple Silicon、Metal、CPU，可选 Core ML。官方普通 base 为 142 MiB 磁盘、约 388 MB 运行内存，small 为 466 MiB、约 852 MB。选择多语言版。base/small 须使用多语权重 | **P2 首选 Mac ASR**。先将旁白另解码为 16 kHz 单声道，再转写中文、保留分段时间戳。不把段级估算描述为逐字对齐。先比 base/small 的专有词错误与校对分钟数；未安装时可继续手工打轴。[模型与许可](https://github.com/openai/whisper) · [实现与资源表](https://github.com/ggml-org/whisper.cpp) · [发布 v1.9.6](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.9.6) |
| faster-whisper 1.2.1 | MIT 实现，CTranslate2，CPU INT8 或 NVIDIA CUDA/cuDNN；支持词时间戳与 VAD，权重来源另记；中文沿用相应多语 checkpoint | 保留作团队 GPU 批转写外部对照；引入 Python/CUDA 环境对一条 30 秒作品收益有限。不能把官方对指定长录音的加速倍率直接用于 M1。[官方实现与基准](https://github.com/SYSTRAN/faster-whisper) |
| SenseVoiceSmall | 支持普通话、粤语等。代码与官方权重条款分列；权重适用 FunASR Model License，有署名、模型命名要求，维护方说明遵守条款可商用。切分、VAD 和对齐需配套 | 若粤语/噪声样本的人工修正负担明显高，再对比同段录音；逐字时间线不能由识别文本直接推定。[具体模型](https://huggingface.co/FunAudioLLM/SenseVoiceSmall) · [模型许可](https://github.com/modelscope/FunASR/blob/58830eca4012644aac0c3218c3ccc7d98f003fda/MODEL_LICENSE) · [维护方澄清](https://github.com/QwenAudio/SenseVoice/issues/334) |
| Qwen3-ASR-0.6B + Qwen3-ForcedAligner-0.6B | 开放权重、Apache-2.0；中文、方言和中英混读；强制对齐将已知文本与语音映射到词/字级时间，需要另一个模型。官方 Transformers / vLLM 实例 | P2 的对照组。只有人工修订后的字幕经对齐后明显少拖动，才值得携带第二套推理依赖。目标 Mac 的端到端资源与质量未测。[ASR 模型卡](https://huggingface.co/Qwen/Qwen3-ASR-0.6B) · [对齐模型卡](https://huggingface.co/Qwen/Qwen3-ForcedAligner-0.6B) |
| Kokoro-82M v1.1-zh / sherpa-onnx | 中文专版卡为 Apache-2.0，Studio 固定中文 ONNX 包 364,855,331 字节、固定 SHA，sherpa-onnx-node 2.0.1 在 CPU 合成 24 kHz。资源包含音色、词典、espeak-ng 数据，各自保留通知与来源 | **P2 首选 TTS**。复用资源管理器与可取消 worker，按段生成暂存 WAV；采用后录入作品资产。底栏朗读的会话和在播音频仍归 LocalTtsService。项目可用生成音频的商用范围还要核具体音色来源、合同和内容；保留录音路径。[中文模型卡](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh) · [推理引擎](https://github.com/k2-fsa/sherpa-onnx) · [Studio 固定资源](../../../../src/main/runtime-components/runtime-resource-catalog.ts) |
| Qwen3-TTS-12Hz-0.6B-CustomVoice / Fun-CosyVoice3-0.5B-2512 | 两个具体模型卡均为 Apache-2.0。Qwen 提供预设说话人，含中文；该 checkpoint 文件树约 2.5 GB。CosyVoice 支持中文、方言、指令/参考音频等路径；仓库有 GPU 加速说明。硬件与音色授权要逐配置确认 | 只用经授权的预设音色做外部候选，比较型号、数字、英文缩写重音。首版不引入克隆、参考音频外传与第二套模型安装。未测 Mac 实时率。[Qwen 代码](https://github.com/QwenLM/Qwen3-TTS) · [权重与文件](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice) · [CosyVoice 模型卡](https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512) |
| macOS 系统语音 | 本机确有中文音色。Tahoe 26 的 Apple 软件许可第 2 节对 System Voices 的使用及以其生成的录音规定个人、非商业使用范围 | 排除为公司宣发配音默认项。系统能试听不构成商业录音授权。[Apple 原文](https://www.apple.com/legal/sla/docs/macOSTahoe.pdf) |

## 可选生成视频

优先级按**这一条产品片的用途**决定。提前拍摄三个真实镜头的成本是可预测的一次拍摄；生成候选还要为每次废片支付算力与人工核验。每个候选记录耗时、费用或 GPU 分钟、是否采用及弃用原因。用「总费用 / 采纳的秒数」比较。当前没有该公司真实采纳率和云端账单，无法填写人民币预算实绩。

| 候选 | 事实、条件与中文 | 决策 |
|---|---|---|
| Wan2.2-TI2V-5B | 官方代码和此权重 Apache-2.0；文/图生视频，支持中英文提示。5B 官方单卡卸载示例要求至少 24 GB VRAM，720p 档实为 1280×704 / 704×1280。24 fps 候选须按目标时基重采样 | **GPU 条件成熟后的首选对照**。外部独立运行，导出短背景或抽象转场，再走普通导入；不上 M1 默认安装，不为选型改远程 Agent。只带获准参考图；几何、屏显文字、延迟和镜头 POV 一律不用生成结果举证。[代码](https://github.com/Wan-Video/Wan2.2) · [具体权重与运行条件](https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B) |
| HunyuanVideo-1.5 | 图/文生视频，模型卡含中英文，Linux + CUDA，卸载时 NVIDIA 显存下限 14 GB。社区权重条款定义的许可地域排除欧盟、英国、韩国，另有分发和使用条件 | 排除默认打包与全球托管。显存较低不能解决合同地域与能力真实性问题。没有实测该机型速度。[权重与配置](https://huggingface.co/tencent/HunyuanVideo-1.5) · [权重许可](https://huggingface.co/tencent/HunyuanVideo-1.5/blob/main/LICENSE) |
| LTX-2.3 | 音视频联合生成，官方管线还需文本编码器等配套权重。模型用 LTX-2 Community License；年收入达 1,000 万美元的实体适用单独商业许可条件。另核所用文本编码器。中文清晰口播、镜腿形状稳定性与 M1 吞吐未在本机测量 | 展示概念片时才值得试。生成声画会让「设备现场收音」与「后配声音」更难辨认；公司样机评测优先使用实录。[模型卡](https://huggingface.co/Lightricks/LTX-2.3) · [官方实现](https://github.com/Lightricks/LTX-2) · [许可原文](https://github.com/Lightricks/LTX-2/blob/main/LICENSE-2) |
| 旧版火山即梦 | 仓库有签名、提交、轮询、下载与采用流程。它是按服务条款访问的云 API，使用权、保留期和费用以该账户合同与提交页为准。代码中的模型名只代表适配目标 | 保留既有兼容入口。本次未提交、未计费，当前账号可用性待实际开通后核实。先显示外发字段、目的地及用量，按场景确认；提交后断线先查原任务。[仓库适配器](../../../../src/main/media-production/providers/jimeng-video-provider.ts) |

**采用门槛。** 识别工具要让同事少改型号、数字和单位。合成声音要能正确念出同一组词并支持单句重做。外部生成只有在抽象过场确有需求、参考素材允许外发且公司能记录费用时才进入制作。
