# 机器人技术栈系统性调研报告：World Model × VLA 全景

> 调研时间：2026年6月 | 覆盖论文/产品截至 GTC 2026（2026年3月）
>
> 本报告由 Deep Research 工作流驱动：5 角度分解搜索 → 24 个来源提取 104 条声明 → 3 轮对抗验证 → 16 条高置信度声明确认 + 额外补充搜索整合

---

## 目录

1. [World Model + VLA 统一融合方案](#一-world-model--vla-统一融合方案)
2. [纯 VLA 方案](#二-纯-vla-方案不涉及-world-model-融合)
3. [非 VLA 的机器人学习方案](#三-非-vla-的机器人学习方案)
4. [纯 World Model 方案](#四-纯-world-model-方案)
5. [数据与基础设施](#五-数据与基础设施)
6. [行业格局总结](#六-行业格局总结)

---

## 一、World Model + VLA 统一融合方案

### 1.1 自变量机器人（AutoVariable）— WALL-A / WALL-B ⭐ 最值得关注的统一方案

这是当前世界模型和 VLA 统一路线最具代表性的公司。2023 年 12 月成立，2026 年累计融资超 20 亿元（字节、阿里、美团、红杉、深创投联合加持），国内唯一被三家互联网巨头同时投资的具身智能企业。

**WALL-A（第一代，2024）**：

- 首创 VLA 与世界模型深度融合的架构，而非简单拼接
- 原生多模态输入输出（视觉 + 触觉 + 语音 → 机器人动作指令）
- 核心机制：具身多模态思维链 + 时空状态预测 + 视觉因果推理 + 可学习记忆内化物理常识
- 2025 年 9 月开源了 **WALL-OSS** 端到端基础模型

**WALL-B（第二代，2026 年 4 月发布）** — 世界统一模型（World Unified Model, WUM）：

- **核心突破**：将视觉、听觉、语言、触觉、动作、物理预测放入同一个网络从零联合训练，消除模块间信息损耗
- 让机器人具备物理"世界观"——理解重力、惯性、摩擦力等物理规律
- 在真实交互中自我进化（从失败中学习并更新模型参数，区别于 VLA 的"死记硬背"）
- 2026 年 5 月 25 日已开始入驻真实家庭干活（与 58 同城合作，深圳家政服务试点）
- 自有本体：量子一号、量子二号（含机械臂、关节模组、动力驱动器等）

> 如果只关注一家做 World Model + VLA 统一的中国公司，自变量就是最核心的标的。

**Sources**：

- [自变量机器人完成 10 亿元 A++ 轮融资](https://stcn.com/article/detail/3586136.html)
- [自变量 WALL-B 世界统一模型发布](https://www.zhidx.com/p/552203.html)
- [自变量机器人构建物理世界基础模型](https://m.163.com/dy/article/KJ342BRQ0514R9KE.html)

---

### 1.2 Physical Intelligence — π0 / π0-FAST（美国）

- **论文**：[π0: A Vision-Language-Action Flow Model for General Robot Control](https://arxiv.org/abs/2410.24164)（2024.10，RSS 2025）
- **架构**：
  - 基于预训练 VLM（PaliGemma）的 flow matching 架构
  - 3.3B parameters，sparse Mixture-of-Experts（MoE）
  - 以 50Hz 输出连续电机动作（区别于 LLM 的离散 token）
  - **π0-FAST**（2025.1）：通过 DCT + BPE action tokenizer 实现 5 倍训练加速
- **关键结果**：零样本语言跟随能力，无需微调即可泛化到新任务
- **开源**：π0 和 π0.5 已集成进 HuggingFace LeRobot v0.4.0（均为 4B 参数）
- **生态**：PI 团队背景极强（Chelsea Finn, Sergey Levine 等），但注意 **π0 本质上仍是 VLA，World Model 融合不是其核心卖点**——它的 Flow Matching 可以理解为隐式学习了动作空间中的物理约束

**Sources**：

- [π0 HuggingFace Blog](https://huggingface.co/blog/pi0)
- [LeRobot v0.4.0 发布](https://huggingface.co/blog/lerobot-release-v040)

---

### 1.3 NVIDIA — GR00T + Cosmos ⚡ 2026 年新标杆

**GR00T N1.6 / N1.7**（2025–2026）：

- 行动 backbone 为 **32 层 diffusion transformer**（是前代的 2 倍大）
- 输出 state-relative action predictions
- NVIDIA 称其整合了 **Cosmos Reason** 世界模型作为推理桥接，将高层指令分解为分步动作规划

**Cosmos 3（2026 年 3 月，GTC 2026）** — 首个统一世界基座模型：

- Cosmos 3 Super — 高保真训练
- Cosmos 3 Nano — 快速视频生成 & 动作推理
- Cosmos 3 Edge — 实时边缘推理（待发布）
- 统一了：合成世界生成 + 视觉推理 + 动作/运动模拟

**GR00T N2（预览，2026 年 3 月）**：

- 基于 **DreamZero** 研究
- 声称在新环境上成功率 2x+ 领先 VLA 模型
- MolmoSpaces & RoboArena 排行榜第 1，计划 2026 年底正式发布

**Isaac Sim & Isaac Lab**：

- Isaac Sim 5.0 + Isaac Lab 2.2（2025.8 GA）
- Isaac Lab 3.0 + Newton Physics Engine 1.0（2026.3 EA）
- Isaac GR00T Reference Humanoid（基于 Unitree H2，Jetson Thor 算力）

**工业合作**：FANUC、ABB、YASKAWA、KUKA（全球 2M+ 装机量）整合 Omniverse + Isaac 仿真
**医疗合作**：CMR Surgical（Versius 手术系统）、Johnson & Johnson MedTech（Monarch 平台）

**Sources**：

- [NVIDIA GR00T N1.6 Blog](https://developer.nvidia.com/blog/building-generalist-humanoid-capabilities-with-nvidia-isaac-gr00t-n1-6-using-a-sim-to-real-workflow/)
- [NVIDIA Cosmos 3 发布（Blockchain.news）](https://blockchain.news/news/nvidia-cosmos-3-groot-n2-robotics-partnerships-gtc-2026)
- [NVIDIA Isaac Sim SDG Workflow](https://developer.nvidia.com/blog/build-synthetic-data-pipelines-to-train-smarter-robots-with-nvidia-isaac-sim/)
- [NVIDIA Expansion of Physical AI (Digital Engineering)](https://www.digitalengineering247.com/article/nvidia-extends-physical-ai-to-robotics/robotics_industry)

---

### 1.4 其他值得关注的 VLA+World Model 探索

#### DiffusionVLA（ICML 2025）

[arXiv:2412.03293](https://arxiv.org/abs/2412.03293) | [Proceedings (PMLR)](https://proceedings.mlr.press/v267/wen25g.html)

- 架构：VLM（Qwen2-VL）自回归推理 + diffusion policy head
- 核心创新：通过 **FiLM（Feature-wise Linear Modulation）** 将自回归推理 token 注入 action 生成过程，实现推理与动作的紧耦合
- 规模：2B / 7B / 72B 三个规模
- 结果：零样本 63.7% 准确率（102 个未见物体 bin-picking）
- 解读：可理解为 AR reasoning + diffusion world model 的混合架构

#### Figure AI — Helix

- Figure 的自有 VLA 模型
- 2026 年 1 月宣布与 **Brookfield**（万亿美元资产管理公司）合作，构建全球最大真实世界人形机器人预训练数据集
- VLA 路线，但未公开是否融合 world model

**Source**：[Figure AI + Brookfield Partnership](https://www.figure.ai/news/figure-announces-strategic-partnership-with-brookfield)

---

## 二、纯 VLA 方案（不涉及 World Model 融合）

### 2.1 RT-2（Google DeepMind，2023）

- **论文**：[RT-2: Vision-Language-Action Models Transfer Web Knowledge to Robotic Control](https://arxiv.org/abs/2307.15818)
- **架构**：将机器人动作编码为文本 token（256 bins），与自然语言共享词表，直接对预训练 VLM（PaLI-X 5B/55B 或 PaLM-E 12B）进行 co-fine-tune
- **关键结果**：6000 次真机评估，大幅提升对未见物体和指令的泛化
- **局限**：动作精度受离散 token 分辨率限制（256 bins），不适合高频精细操作
- **验证**：3-0 确认（动作作为文本 token + 共享词表的架构描述、6000 trial 评估结果）

### 2.2 OpenVLA（Stanford/UC Berkeley，2024，开源 ⭐）

- **论文**：[OpenVLA: An Open-Source Vision-Language-Action Model](https://arxiv.org/abs/2406.09246)（ICML 2024）
- **架构**：7B 参数，Llama 2 语言模型 backbone + 融合视觉编码器（DINOv2 + SigLIP）
- **训练数据**：970k 条真实机器人演示数据（Open X-Embodiment 的子集）
- **关键结论**：声称比 RT-2-X（55B）高出 16.5% 绝对成功率（但验证团队质疑此声明，1-2 投票否决——需注意，原始论文声明可能被夸大）
- **开源**：✅ 完全开源，可在 HuggingFace 下载，社区活跃
- **验证**：3-0 确认架构描述（7B + Llama 2 + DINOv2 + SigLIP + 970k demos）

### 2.3 Octo（UC Berkeley/Google，2024，开源）

- **论文**：[Octo: An Open-Source Generalist Robot Policy](https://arxiv.org/abs/2405.12213)
- **架构**：93M-参数 transformer（远小于 VLM），基于 transformer 的 diffusion policy
- **关键结果**：
  - 比 RT-1-X 平均高出 **29% 零样本成功率**（跨 WidowX, UR5, RT-1 Robot 三个平台）—— 2-1 验证确认
  - 在约 100 条目标任务演示微调后达到 **72% 平均成功率**（比从零训练的 ResNet+Transformer 的 20% 高出 52 个百分点）—— 3-0 确认
- **特色**：参数量极小（93M），适合部署、速度极快
- **开源**：✅

### 2.4 Skild AI — Skild Brain

- **2026 年 1 月完成 14 亿美元 C 轮融资**（SoftBank 领投，NVIDIA、Bezos、三星、LG 参投），估值超 140 亿美元
- 自称首个通用具身基础模型，覆盖多种机器人形态（四足、双足、轮式、机械臂、灵巧手）
- **关键区别**：Skild **并非 VLA 也并非 World Model**，而是端到端视觉条件控制范式，采用分层架构（上层低频规划 + 下层高频动作网络）
- 与 OpenAI 投资的 **Covariant**（RFM: Robot Foundation Model）为直接竞品

**Source**：[Skild AI $1.4B Series C](https://www.businesswire.com/news/home/20260114335623/en/Skild-AI-Raises-$1.4B-Now-Valued-Over-$14B)

---

## 三、非 VLA 的机器人学习方案

### 3.1 Diffusion Policy 方案

| 方案                    | 时间      | 核心思路                                                                           |
| ----------------------- | --------- | ---------------------------------------------------------------------------------- |
| **Diffusion Policy v1** | 2023      | 将机器人动作视为视觉条件去噪过程，预测连续动作序列（而非单步），处理多模态动作分布 |
| **Diffusion Policy v2** | 2024      | 改进架构 + 更高效的训练策略                                                        |
| **ChainedDiffuser**     | 2024      | 将长程任务分解为链式 diffusion 步骤                                                |
| **DiffusionVLA**        | ICML 2025 | 融合 AR 推理 + Diffusion action（已在 §1.4 讨论）                                  |
| **DexGraspVLA**         | 2025.2    | VLM 做高层规划 + Diffusion Policy 做低层灵巧抓取，90%+ 成功率                      |

**优势**：自然处理多模态动作分布（比 VLA 的离散 token 更精细），对剧烈变化的环境鲁棒
**局限**：推理速度慢于 VLA，长程推理能力弱

### 3.2 MPC + Model-Based RL 方案

**核心综述**：[Synthesis of Model Predictive Control and Reinforcement Learning: Survey and Classification](https://arxiv.org/abs/2502.02133)（Reiter et al., Feb 2025, _Annual Reviews in Control_）

**主流融合范式**：

1. **MPC as expert for RL** — 用 MPC 生成训练数据（仿真中 MPC rollout → 训练 RL policy）
2. **MPC inside policy** — 将 MPC 作为 policy 的一部分（如 AC4MPC: Actor-Critic 框架下用 critic 作为 MPC 的近似值函数）
3. **MPC for value function** — MPC 在线优化用于确定 value

**典型应用**：

- 四足机器人运动控制（MIT Cheetah、Unitree 等 — MPC + RL 混合）
- 双足步行（Bipedal control — MPC 提供稳定性和安全性保证）
- 自动驾驶规划

**软件生态**：

- MPC4RL（2025.1 开源）：结合 Gymnasium/stable-baselines3 与 acados 的 MPC+RL 工具包
- 最新综述也指出：MPC 生成的轨迹数据现在是模仿学习系统最常用的训练数据来源

**局限**：

- MPC 计算成本高，需要已知或学到的动力学模型
- 在复杂非刚体操作任务上不如 VLA/Diffusion Policy 灵活

### 3.3 LLM 做任务规划 + 低层控制

| 方案                 | 团队   | 年份 | 思路                                            |
| -------------------- | ------ | ---- | ----------------------------------------------- |
| **SayCan**           | Google | 2023 | LLM 将自然语言分解为子任务 → 低级技能控制器执行 |
| **PaLM-E**           | Google | 2023 | VLM + 端到端控制（RT-2 的前身）                 |
| **Code as Policies** | Google | 2023 | LLM 生成 Python 代码作为策略                    |
| **VoxPoser**         | MIT    | 2023 | LLM + VLM 交互生成 3D 值图作为低级控制器引导    |

**趋势判断**：2025 年后，端到端 VLA 方案正逐步取代分层 LLM+low-level 方案，因为端到端可以避免中间表示的信息损失。

---

## 四、纯 World Model 方案

### 4.1 Dreamer 系列

| 版本           | 时间           | 亮点                                                                                                               |
| -------------- | -------------- | ------------------------------------------------------------------------------------------------------------------ |
| DreamerV1      | 2020           | RSSM（Recurrent State-Space Model）世界模型 + latent imagination                                                   |
| DreamerV2      | 2021           | Categorical latent、改进的 world model 训练                                                                        |
| **DreamerV3**  | 2024（Nature） | [Nature 论文](https://www.nature.com/articles/s41586-025-08644-5) — 单一超参数集横跨 150+ 任务，Minecraft 钻石收集 |
| **DayDreamer** | 2023（CoRL）   | DreamerV3 在真实机器人上的应用（推、抬、走路）                                                                     |

**2025 年延续工作**：

| 工作                        | 时间    | 内容                                                                            |
| --------------------------- | ------- | ------------------------------------------------------------------------------- |
| **DreamerNav**              | 2025.9  | DreamerV3 扩展到四足导航，EGO 深度图 + RSSM 长程预测，Isaac Sim 训练 → 真实迁移 |
| **LED-WM**                  | 2025    | 语言条件世界模型，DreamerV3 + 语言感知编码器                                    |
| **VLM-in-the-loop Dreamer** | 2025    | Dreamer 做 latent 预测 → VLM 翻译为行为描述 → MPC 选择安全动作序列              |
| **Dreamer + LIDAR**         | 2025.12 | MLP-VAE 编码 LIDAR 到 latent，TurtleBot3 上 100% 成功率（基线 <85%）            |
| **JST-Dreamer（人形）**     | 2025    | Jensen-Shannon divergence 改进 DreamerV3 world model 损失，HumanoidBench 测试   |

### 4.2 NVIDIA Cosmos（已在 §1.3 覆盖）

从视频生成世界模型出发，扩展到物理 world foundation model。Cosmos 3（GTC 2026）是当前最完整的工业级世界模型。

### 4.3 世界模型的核心局限

**Physical Intelligence 的实验**得出结论（经验证）：将模型扩大 10 倍 + 塞入更多互联网图片，**对物理交互的预测能力几乎是一条水平线**。World Model 的 scaling law 在物理世界任务上遇到瓶颈。互联网数据中物理交互信息稀少，单纯增大模型和数据量不解决问题。

这也解释了为什么当前行业正转向 **World Model + VLA 统一融合**（而非纯 world model 路线），以及为什么自变量强调"真机数据采集"和"物理交互数据"的重要性。

---

## 五、数据与基础设施

### 5.1 主要训练数据集

| 数据集                | 规模                                            | 维护方                 | 特点                                         |
| --------------------- | ----------------------------------------------- | ---------------------- | -------------------------------------------- |
| **Open X-Embodiment** | 1M+ 轨迹，22 机器人平台，60+ 子数据集，527 技能 | Google DeepMind        | 标准化 RLDS 格式，RT-X/Octo/OpenVLA 训练基础 |
| **DROID**             | 76k 轨迹（350 小时），86 任务，13 机构          | 跨洲合作               | 场景多样性极高，手持抓取为主                 |
| **BridgeData V2**     | 60,096 轨迹（50k 遥操 + 9.7k 脚本），24 环境    | UC Berkeley RAIL Lab   | 学术研究最常用，WidowX 250 6DOF              |
| **HumanoidBench**     | —                                               | —                      | 标准人形机器人操作/运动基准                  |
| **RLBench**           | 100+ 任务                                       | —                      | VLA 评估基准，自然语言指令                   |
| **Figure+Broadfield** | 构建中（全球最大）                              | Figure AI + Brookfield | 真实世界人形机器人数据                       |

### 5.2 仿真器

| 仿真器                     | 特点                       | 最新动态                                                               |
| -------------------------- | -------------------------- | ---------------------------------------------------------------------- |
| **MuJoCo**                 | 轻量、快速、物理准确       | 免费开源，最广泛使用                                                   |
| **NVIDIA Isaac Sim**       | 高保真、光线追踪           | Isaac Sim 5.0（2025.8 GA）+ Isaac Lab 3.0（2026.3 EA，新牛顿物理引擎） |
| **SAPIEN**                 | 基于物理、丰富关节物体交互 | 操作任务仿真首选                                                       |
| **PyBullet / CoppeliaSim** | 轻量、易用                 | 学术研究常用                                                           |
| **Habitat 3.0**            | 家庭/导航                  | 结合 Helen 数字人                                                      |

### 5.3 关键基础设施与工具

| 项目                              | 类型       | 说明                                                                           |
| --------------------------------- | ---------- | ------------------------------------------------------------------------------ |
| **HuggingFace LeRobot v0.4.0**    | 训练框架   | 集成 pi0/pi0.5（4B VLA）、Diffusion Policy、ACT 等，统一训练+推理接口 ⭐       |
| **NVIDIA OSMO**                   | 编排工具   | 编排端到端合成数据生成（Isaac Sim + MobilityGen → Cosmos Transfer → 训练数据） |
| **MPC4RL**                        | 开源工具包 | 结合 Gymnasium/stable-baselines3 与 acados 的 MPC+RL 工具包（2025.1）          |
| **RLDS**                          | 数据格式   | Google 的机器人学习数据格式标准                                                |
| **Optimus (Cyberspace Robotics)** | 仿真平台   | 多机器人仿真集成平台                                                           |

---

## 六、行业格局总结

### 6.1 全图谱对比

| 范式                       | 典型代表                | 泛化能力 | 精度  | 推理速度 | 数据需求 | 开源    |
| -------------------------- | ----------------------- | -------- | ----- | -------- | -------- | ------- |
| **VLA + World Model 统一** | WALL-B（自变量）        | ★★★★★    | ★★★★  | ★★★      | 极高     | ⚡ 部分 |
| **VLA（端到端大模型）**    | π0 / RT-2 / OpenVLA     | ★★★★     | ★★★   | ★★★★     | 极高     | ✅ 部分 |
| **VLA（小型高效）**        | Octo（93M）             | ★★★      | ★★★   | ★★★★★    | 中       | ✅      |
| **Diffusion Policy**       | DP v2 / ChainedDiffuser | ★★★      | ★★★★★ | ★★       | 中       | ✅      |
| **MPC + RL 混合**          | AC4MPC / MPC4RL         | ★★       | ★★★★  | ★        | 低-中    | ✅      |
| **纯 World Model**         | DreamerV3 / Cosmos      | ★★★★     | N/A   | ★★       | 中-高    | ✅ 部分 |
| **LLM 分层规划**           | SayCan / VoxPoser       | ★★★      | ★★    | ★★★★     | 低       | ✅      |

### 6.2 商业化进展

| 公司                       | 估值/融资                 | 方案                   | 商业化状态                         |
| -------------------------- | ------------------------- | ---------------------- | ---------------------------------- |
| **Physical Intelligence**  | 未公开（估值传言 20 亿+） | π0 VLA                 | 工业场景 pilot                     |
| **Skild AI**               | $140 亿                   | Skild Brain（非 VLA）  | 通用机器人基础模型服务             |
| **自变量（AutoVariable）** | 累计融资 20 亿元+         | WALL-B（世界统一模型） | 2026.5 进入家庭场景（58 同城试点） |
| **Figure AI**              | 传闻百亿美元级            | Helix（VLA）           | 人形机器人                         |
| **Covariant**              | 未公开                    | RFM（机器人基础模型）  | 工业分拣部署中                     |
| **NVIDIA**                 | —                         | GR00T + Cosmos 3       | 平台级，提供模型+仿真+工具链       |
| **Google DeepMind**        | —                         | RT-2 / RT-X            | 研究为主，部分技术内部产品化       |

### 6.3 关键趋势

1. **2025–2026 年的最大趋势是 VLA + World Model 融合**：自变量 WALL-B 和 NVIDIA Cosmos 3 + GR00T N2 是最新代表
   - 自变量走**同一网络联合训练**（数据驱动型深度融合）
   - NVIDIA 走**模块化桥接**（Cosmos Reason 作为独立推理模块接入 VLA）

2. **World Model 的 scaling law 存在瓶颈**：PI 的实验确认，单纯增大 web image 数据无法提升物理交互预测能力
   - 解决方案 A：增加**真机物理交互数据**（Figure+Broadfield、自变量的"牛奶数据"）
   - 解决方案 B：世界模型 + VLA 端到端联合训练（从 action 反馈中学习物理规律）

3. **DiffusionVLA 揭示了新的混合范式**：用 diffusion 做 action head 替代 AR 的 next-token 预测，有望统一推理质量与动作精度

4. **开源生态快速成熟**：HuggingFace LeRobot v0.4.0 已集成主流模型，研究门槛大幅降低

### 6.4 技术选型建议

| 场景                        | 推荐方案                  | 理由                             |
| --------------------------- | ------------------------- | -------------------------------- |
| 研究/实验                   | **OpenVLA** + LeRobot     | 完全开源、社区活跃、7B 够用      |
| 工业精度需求                | **Diffusion Policy v2**   | 动作分布最精细，MPC 可加安全约束 |
| 高频实时控制（四足/灵巧手） | **Octo（93M）**           | 轻量极速，微调数据需求低         |
| 长程任务 + 自然语言理解     | **VLA（π0 / OpenVLA）**   | VLM backbone 带来的泛化能力      |
| 家庭服务 / 高度非结构化     | **WALL-B** / **GR00T N2** | 世界模型带来物理常识推理         |
| 安全关键系统                | **MPC + RL 混合**         | 约束保证，可验证                 |

---

## 来源汇总

| #   | 链接                                                                                                                                                             | 质量      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | [π0: Vision-Language-Action Flow Models](https://arxiv.org/abs/2410.24164)                                                                                       | primary   |
| 2   | [RT-2: Vision-Language-Action Models](https://arxiv.org/abs/2307.15818)                                                                                          | primary   |
| 3   | [OpenVLA: An Open-Source VLA](https://arxiv.org/abs/2406.09246)                                                                                                  | primary   |
| 4   | [Octo: An Open-Source Generalist Robot Policy](https://arxiv.org/abs/2405.12213)                                                                                 | primary   |
| 5   | [DiffusionVLA (ICML 2025)](https://arxiv.org/abs/2412.03293)                                                                                                     | primary   |
| 6   | [DreamerV3 Nature Paper](https://www.nature.com/articles/s41586-025-08644-5)                                                                                     | primary   |
| 7   | [Open X-Embodiment (Google DeepMind)](https://github.com/google-deepmind/open_x_embodiment)                                                                      | primary   |
| 8   | [DROID Dataset](https://droid-dataset.github.io/)                                                                                                                | primary   |
| 9   | [BridgeData V2](https://rail-berkeley.github.io/bridgedata/)                                                                                                     | primary   |
| 10  | [NVIDIA GR00T N1.6 Blog](https://developer.nvidia.com/blog/building-generalist-humanoid-capabilities-with-nvidia-isaac-gr00t-n1-6-using-a-sim-to-real-workflow/) | primary   |
| 11  | [Figure AI + Brookfield](https://www.figure.ai/news/figure-announces-strategic-partnership-with-brookfield)                                                      | primary   |
| 12  | [Skild AI $1.4B Series C](https://www.businesswire.com/news/home/20260114335623/en/Skild-AI-Raises-$1.4B-Now-Valued-Over-$14B)                                   | secondary |
| 13  | [MPC+RL Survey (Reiter et al. 2025)](https://arxiv.org/abs/2502.02133)                                                                                           | primary   |
| 14  | [LeRobot v0.4.0](https://huggingface.co/blog/lerobot-release-v040)                                                                                               | blog      |
| 15  | [π0 HuggingFace Blog](https://huggingface.co/blog/pi0)                                                                                                           | blog      |
| 16  | [PI 物理交互 scaling law 讨论](https://36kr.com/p/3834566686879879)                                                                                              | secondary |
| 17  | [自变量机器人 10 亿元 A++ 轮融资](https://stcn.com/article/detail/3586136.html)                                                                                  | secondary |
| 18  | [自变量 WALL-B 世界统一模型](https://www.zhidx.com/p/552203.html)                                                                                                | secondary |
| 19  | [NVIDIA Cosmos 3 发布](https://en.theblockbeats.news/flash/336534)                                                                                               | secondary |
| 20  | [Isaac Sim SDG Workflows](https://developer.nvidia.com/blog/build-synthetic-data-pipelines-to-train-smarter-robots-with-nvidia-isaac-sim/)                       | blog      |
| 21  | [NVIDIA Evolves Physical AI](https://www.digitalengineering247.com/article/nvidia-extends-physical-ai-to-robotics/robotics_industry)                             | secondary |
| 22  | [OpenVLA ICML Paper (PMLR)](https://proceedings.mlr.press/v270/kim25c.html)                                                                                      | primary   |
| 23  | [DiffusionVLA Proceedings](https://proceedings.mlr.press/v267/wen25g.html)                                                                                       | primary   |
| 24  | [DreamerNav (Frontiers in Robotics 2025)](https://www.frontiersin.org/journals/robotics-and-ai/articles/10.3389/frobt.2025.1655171)                              | primary   |

---

> **编辑**：本报告由 Deep Research 工作流驱动生成 + 人工整合，经过多重交叉验证。标注了验证团队对部分声明的质疑状态。如需深入某个方向，可随时展开调研。
