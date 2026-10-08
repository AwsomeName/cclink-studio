# 神经电路实验室目录与模块架构

> 状态：架构提案，尚未实现。2026-10-09。
> 遵循 [架构宪法](../architecture.md)、[工作空间系统](../features/workspace-system.md) 与 [统一上下文操作](../features/context-action-system.md)。

## 结论与能力边界

需要专门的领域文件结构与模块支持，但不新增第二种 Studio 工作空间。一个已有本地工作空间可包含多个研究目录，每个目录保存模型、电路、映射、实验和证据。界面标签页仍由 Studio Workbench 管理。

Studio 负责编辑、调用和证据管理，外部求解器负责计算。首轮仅本地单机、一个经过验证的求解器、受限模型格式与一个活动仿真；不建设云计算调度、通用求解器插件框架或新的 Agent runtime。

本轮只落地文档及效果示意。下文目录、字段、状态和服务名称均为建议，不是当前源码事实，也不要求预先创建全部空目录。

## 研究目录结构

```text
现有本地工作空间/
└── neural-studies/
    └── worm-memristor/
        ├── study.json                 # 领域入口、格式版本、对象索引
        ├── README.md                  # 研究目标与复现操作
        ├── sources/                   # 原始连接数据、参考数据、来源与授权
        │   └── source-manifest.json
        ├── networks/                  # 神经模型：拓扑、动力学、参数
        │   └── worm.network.json
        ├── devices/                   # 器件描述及其模型文件
        │   └── memristor-a/
        │       ├── device.json
        │       └── model/             # 选定格式的原始模型，不自动执行
        ├── circuits/                  # 电气拓扑、元件、参数、画布布局
        │   └── pulse-response.circuit.json
        ├── mappings/                  # 神经对象 → 电路对象及转换假设
        │   └── worm.mapping.json
        ├── experiments/               # 可编辑的实验定义，不保存运行终态
        │   └── pulse-response.experiment.json
        ├── runs/                      # 每次运行的固定输入及结果证据
        │   └── <run-id>/
        │       ├── run.json           # 主进程唯一写入的状态和输出索引
        │       ├── inputs/            # 本次输入依赖的自包含快照
        │       │   └── manifest.json  # 路径、哈希、来源版本、环境指纹
        │       ├── generated/         # 本次生成的网表、受控工具输入
        │       ├── outputs/           # 原始数据及规范化信号索引
        │       └── logs/              # 脱敏诊断与工具输出
        ├── reports/                   # 可编辑备注、比较报告与导出文件
        ├── chip/                      # 后续按具体工具设计，不首轮创建
        └── hardware/                  # 后续硬件定义，不保存本机连接秘密
```

用户可更改研究目录名和位置，通过原生文件选择打开 `study.json` 或所在目录。`studyId` 是领域文档 ID，不替代 Studio `workspaceKey`。首轮禁止同一 App 通过两个路径重复挂载同一真实目录，路径经规范化校验。

### 文件边界与页面对应

| 文件域 | 编辑或呈现页面 | 事实内容 |
| --- | --- | --- |
| study.json | 首页 | 标题、格式版本、对象引用；不复制工作空间与 Tab 状态 |
| sources / networks | 神经网络 | 数据集版本、神经对象、方程、连接、参数依据 |
| devices | 器件与模型 | 参数单位、模型格式、模型文件、适用范围、来源授权 |
| circuits / mappings | 电路设计 | 电气设计与神经对应关系；画布坐标是非电气属性 |
| experiments | 实验配置 | 刺激、初态、求解配置、测量与比较判据 |
| runs | 仿真与结果、实验记录 | 输入快照、环境、计算状态、输出与失败原因 |
| reports | 实验记录 | 解释和研究结论，引用固定 run ID；不修改原始输出 |
| chip / hardware | 芯片、FPGA | 未来工具输入与证据，具体结构待条件确定 |

## 对象与引用规则

对象包含稳定 ID、格式版本和 revision。引用同时保存对象 ID、研究根相对路径；路径负责定位，ID 防止误认，内容哈希负责确认运行输入。重命名由领域服务更新引用；发现外部移动或 ID 不一致时显示冲突，不静默绑定同名文件。

`study.json` 只索引对象及其类型，不内嵌全网络和全波形。实验引用电路、刺激、器件及必要映射；首轮不支持任意依赖循环。映射明确一对多、多对一、尺度换算、简化假设和未映射项，不隐含“一神经元等于一个忆阻器”。

相对引用不能越出研究根；导入外部依赖时复制进入受管理目录并保留来源。递归依赖及软链接必须规范化检查，缺依赖阻止运行。不能使用工作空间里的 shell 字符串作为自动执行命令。

网络的大数据编码、波形二进制格式及支持的模型格式，必须经过实际规模与求解器试验确定。概念页不提前承诺支持全部格式。

## 可移植内容与本机状态

研究目录保存可共享科学输入。求解器绝对路径、许可证环境、板卡端口和本机设备绑定由主进程保存到现有本机配置边界，不随研究目录运输；第三方秘密沿用受限凭证服务，禁止系统钥匙串和日志泄露。

Tab、选中视图和可恢复布局复用 WorkspaceState；运行成功状态不写入 WorkspaceState。派生图布局、波形预览与索引缓存可放在 `userData` 下领域缓存分区，丢失后可重建；原始证据不能仅存在缓存。

Git 默认建议跟踪 sources、networks、devices、circuits、mappings、experiments 和必要报告。大体积输出可忽略，但忽略即不具备完整证据分享；导出复现包时显式选择输入、证据及许可证允许的模型。修改 `.gitignore` 前展示范围，不自动上传第三方数据或 PDK。

## 运行快照与复现

1. 主进程检查 workspace、study、experiment 和 revision；保存编辑或明确采用草稿。
2. 校验依赖、单位、求解器与输出作用域，复制依赖形成临时输入快照。
3. 对复制内容计算哈希并验证文档 revision；发现保存冲突或外部变化则拒绝启动。受管理文件通过串行保存和 revision 校验；外部文件经复制快照运行，不声称复现正在变动的源目录。
4. 完成输入 manifest，原子提交快照后启动固定适配器的外部进程。
5. 记录命令参数、工具版本、设置、随机种子（若适用）、退出码和输出文件哈希；默认脱敏。
6. 成功须同时满足工具成功退出、输出完整且可解析。功能判据单独显示通过、失败或未定义，不能用退出码替代生物验证。
7. 输入、generated 和原始 outputs 在终态后保持不变；备注与分析写入 reports。损坏或人工修改的证据在读取时标记，不能继续称原运行已验证。
8. 重跑创建新 run ID，引用原运行；环境不匹配显示差异。固定输入保证可追溯，不承诺不同平台必然逐位一致。

首轮每个研究目录最多一个活动仿真，不排队，不引入通用调度器。run.json 是仿真领域唯一持久运行记录，禁止再建一份全局仿真任务账本；实验记录页面由这些文件生成查询投影。

## Studio 源码模块建议

以下均为计划目录，仅在相应纵向能力实现时建立：

```text
src/
├── shared/neural-lab/
│   ├── study-types.ts              # 领域对象与引用
│   ├── study-schema.ts             # 持久化数据校验
│   ├── simulation-types.ts         # 运行、信号、错误与证据
│   └── neural-lab-contract.ts      # IPC / 事件单一声明源
├── main/neural-lab/
│   ├── neural-lab-service.ts       # 领域门面、workspace/study 作用域
│   ├── study-repository.ts         # 校验、revision、原子保存、恢复
│   ├── snapshot-builder.ts        # 输入依赖快照和哈希
│   ├── simulation-service.ts      # 运行唯一 owner、取消与重启对账
│   ├── result-reader.ts           # 有界输出解析、信号分段读取
│   ├── neural-lab-ipc.ts           # 注册既有 contract，不重复 channel
│   └── solvers/
│       ├── solver-adapter.ts       # 内部接口，不构建外部插件宿主
│       └── <selected>-adapter.ts   # 只有首个验证通过的工具
└── renderer/src/features/neural-lab/
    ├── NeuralLabSidebar.tsx        # 现有 Activity/侧栏接入
    ├── NeuralLabTab.tsx            # 现有 Workbench 承载
    ├── pages/                     # 九个领域视图按实际能力逐个加入
    ├── components/                # 网络画布、电路画布、波形与属性
    ├── neural-lab-store.ts         # 投影、选中、草稿；不拥有进程状态
    ├── neural-lab-contribution.ts  # 命令、快捷键、上下文操作
    └── neural-lab.css
```

preload 通过现有 `ipc-contract-client` 消费共享声明，不新增求解器权限 API 或第二条 IPC 管道。模块注册和清理纳入既有 runtime 声明。源码具体名称仍需实施前核对现有注册接入点；不能凭这个树直接批量建框架。

## 状态所有者

| 状态域 | 唯一所有者 | 其他层职责 |
| --- | --- | --- |
| Workspace、Tab、Terminal、Agent | Studio 现有基础层 | 领域仅持引用与受校验调用 |
| 已保存研究文档 | StudyRepository / NeuralLabService 的串行提交 | renderer 持 revision 草稿，冲突时不覆盖 |
| 仿真运行、进程与终态 | SimulationService | 适配器返回事实；renderer 查询和订阅 |
| 工具版本与可用性 | 主进程求解器探测 | UI 显示 ready/degraded/unavailable/failed 与原因 |
| 神经与电路映射 | 保存的 mapping 文档 | 页面计算派生高亮，不复制第二份映射 |
| 原始输出 | run 下工具产物，服务登记和校验 | 波形页有界读取，不能反写原始数据 |
| 报告与备注 | 受 revision 保护的文档保存 | 与运行事实分离 |

领域 run ID 与关联 Agent run ID 区分，仿真不是新的 Agent 执行。若用户通过 Terminal 手工跑工具，该 Terminal 归原 owner；未受 SimulationService 管理的输出只能显式导入为“外部结果”，不能伪装为受控运行。

## 生命周期、权限与失败降级

运行状态建议：preparing → running → succeeded/failed；停止走 cancelling → cancelled。工具和在途结果读取未结束时保持 cancelling，不提前释放执行名额。快照阶段失败记 failed；清理临时文件不损坏已有运行。

切换工作空间解绑旧 UI 订阅，仿真可继续，但始终绑定创建时的 workspace 和研究根；新页面不得接收旧域结果。窗口重建查询主进程事实。退出时请求停止并刷盘；下次启动将失去进程 owner 的非终态记为 interrupted，保留部分输出，不自动重启或声称恢复执行。移走或删除活动研究目录时停止并报告 owner/path 丢失。

主进程校验 sender、工作空间作用域、路径、版本与读取限额。求解器以固定 executable 和参数数组启动，不拼接 shell，不在 renderer 运行 Node。子进程继承最小环境，不把 Studio 凭证传给工具。该方式不等于 OS 沙箱；首轮仅运行用户明确选择且受支持的模型与工具，不允许任意模型脚本自动执行。

工具缺失、许可证失败或数据不支持，只影响当前实验。超时、取消失败、进程退出、输出不可解析、磁盘不足、外部编辑冲突分别呈现结构化原因。日志关联 workspace、study、experiment、simulationRun、solver 和阶段；原始工具输出可能含路径或敏感信息，导出诊断需脱敏且有大小限制。

硬件页后续须独立设计设备 owner、连接清理、刺激限值、断连处理与人工授权；Android 的 ADB 管理不能直接当作 FPGA 设备管理。芯片页后续按真实工具与 PDK 增量设计，不假设已有制造能力。

## 验证与架构拷问

实现时需要有意义的边界测试：越界引用、依赖快照、revision 冲突、终态竞态、取消、异常输出、重启中断和 workspace 切换隔离；随后在真实 Studio 执行产品文档的端到端动作。受影响 smoke 或 `pnpm verify` 必须通过，但不替代真人结果。

首轮不需要复制 Workspace、Tab 或生命周期，因此本提案未要求架构宪法例外。若工具安装、第三方模型执行、硬件控制或远端计算需要扩展权限，实施前重新评审；需要例外时先提交 ADR。

仍须验证的假设：首个模型与求解器可兼容；电路画布所选库可保存可复现拓扑；完整网络和大波形不会拖垮 renderer；分段读取和数据格式支持目标规模。任何一个未验证，都不能用预建目录或页面数量宣称主线完成。

下一步最值得做的是选定一个真实可运行的忆阻器示例和求解器，确定文件格式与输出语义，再收敛首轮实现计划。用户尚未要求开始实现。
