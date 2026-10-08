# 机器人远程仿真与训练工作台讨论稿

> 状态：低优先级方案讨论，尚未实现。最后更新：2026-10-09。
> 首轮按不依赖 CCLink 的远程 Ubuntu 主机设计，连接候选为 frp；真机控制不在首轮范围。

## 结论

Ubuntu 主机负责运行仿真器、ROS、训练和推理进程；Studio 负责配置主机、选择任务、启动与停止、查看实时画面、日志、指标和运行产物。首轮不把 Isaac Sim、MuJoCo 或 ROS Runtime 装入 Studio，也不新增第二套项目系统。

现有 Workspace 继续是机器人代码、模型和配置的工作边界。远程计算主机作为 Studio 本机全局资源管理；工作空间只保存不含凭证的主机引用、远程目录和任务定义。专用“机器人”面板提供操作入口和运行投影，但不拥有远端进程或仿真状态。

## 首个用户验收闭环

1. 用户在 Studio 配置通过 frp 可达的 Ubuntu 主机，并完成连接和运行环境检查。
2. 打开已有机器人 Workspace，选择 G1 模型、场景和已有策略 checkpoint。
3. 点击“运行推理”，Ubuntu 启动 MuJoCo 或 Isaac 仿真及策略进程，并返回稳定 `runId`。
4. Studio 显示实时仿真画面、日志、轨迹、接触或碰撞事件；画面与数据明确关联到本次运行。
5. Studio 断线或关闭后，远端运行继续；重新打开后按 `runId` 恢复状态、日志和画面。
6. 用户点击停止，远端确认相关进程已经退出；Studio 保存本次运行的配置、终态和产物引用。

训练任务在该闭环之后接入。训练默认无画面后台运行，Studio 显示训练步数、reward、loss、GPU 使用、最近日志和 checkpoint；需要观察策略时单独启动短时可视化评估。

## 系统结构

```text
Studio
├─ 计算主机配置
├─ 机器人面板与运行 Tab
├─ Workspace 内的任务定义
└─ Agent 使用同一受控任务入口
        │
        │ HTTPS / WebSocket，经 frp 或可信专网
        ▼
Ubuntu Robot Runner
├─ 环境与能力探测
├─ start / status / attach / stop
├─ 日志、指标和产物索引
├─ Isaac Sim / MuJoCo / Gazebo
└─ 训练、推理、ROS 与可视化桥接进程
```

控制、画面和数据分为三条通道：

- 控制通道：启动、查询、重连和停止任务，返回真实 ACK、状态、失败原因和终态。
- 画面通道：Isaac 优先使用 WebRTC；其他仿真器可使用受控桌面串流或专门的视频/WebRTC 桥接。
- 数据通道：ROS/Foxglove 或等价结构化协议传回关节、轨迹、接触、碰撞、传感器和系统指标；视频像素不能替代这些证据。

任一通道失败只降级对应能力。画面断开不能终止训练；日志连接断开不能把任务标为失败；Studio 与远端失联时状态显示未知或重连中，不能推测成功或停止。

## Ubuntu Robot Runner

正式能力使用轻量、受控的 Runner，不以长期 SSH shell 作为任务事实源。临时验证可以通过 frp 后的 SSH 和现有 Terminal 启动脚本，但该方式不能可靠提供断线恢复、唯一终态和精确停止。

Runner 的最小职责：

- 探测操作系统、GPU、驱动、容器或 Conda 环境及已支持的仿真器；
- 只在声明的远程 Workspace 内启动经过定义的任务；
- 为每次执行生成稳定 `runId`，记录进程、开始时间、当前阶段、退出码和失败原因；
- 以真实进程和仿真事件驱动状态，不按计时或 Agent 自述标记成功；
- Studio 断开后继续任务，重连后支持 `attach` 和日志续接；
- 协作式停止后核验整个进程组已经结束，无法确认时返回未知而不是伪装成功；
- 索引 checkpoint、MCAP、视频、TensorBoard 日志和诊断文件，不默认上传全部大文件。

首轮不建设通用集群调度、任务队列或插件框架。同一 Workspace 是否允许多个并行训练需在实施前根据 GPU 和运行隔离方式决定。

## Studio 配置与界面

### 全局计算主机

设置页增加“计算主机”，保存：

- 显示名称和 Runner 地址；
- TLS 与服务身份信息；
- 本地凭证引用；
- 最近一次能力探测、连接状态和脱敏诊断。

认证信息由现有 `CredentialService` 管理，不写入 Workspace、日志或 renderer 全量状态。Runner 默认只监听本机或可信网络地址，再由 frp 映射；不得把无认证的 Runner、Isaac WebRTC、Foxglove 或 SSH 端口直接暴露到公网。

### Workspace 任务定义

工作空间保存不含密钥的机器人配置，概念结构如下：

```yaml
host: ubuntu-gpu
remoteWorkspace: /home/user/unitree_rl_lab

tasks:
  g1-inference:
    type: inference
    target: simulation
    entrypoint: scripts/run-g1-inference.sh
    viewer: isaac-webrtc
    telemetry: ros2

  g1-training:
    type: training
    target: simulation
    entrypoint: scripts/train-g1.sh
    metrics: tensorboard
```

任务定义需要在实施时设计运行时 schema、允许参数、就绪条件、停止方式和产物规则。Agent 修改任务文件不能自动扩大远端权限；首次运行新定义或权限范围变化时必须由可信入口重新校验。

### 机器人面板

候选面板包含：

- 当前计算主机、连接状态和能力诊断；
- 当前机器人、模型、场景、策略与目标类型；
- 推理、训练、停止和重新连接入口；
- 活动运行及历史终态；
- 仿真画面、结构化轨迹与碰撞数据；
- 日志、训练曲线、GPU 状态和 checkpoint 等产物。

面板复用现有 Workspace、Tab、Terminal、Browser 和 Agent，不复制它们的状态。用户按钮和 Agent 调用相同的受校验命令；Agent 不获得独立 SSH 通道。

## 状态所有权与生命周期

| 状态 | 唯一所有者 |
| --- | --- |
| Workspace、Tab 与可见工作台投影 | Studio 现有基础层 |
| 认证凭证 | `CredentialService` |
| 远端进程、心跳、退出码和日志游标 | Ubuntu Robot Runner |
| 仿真时间、世界状态、接触和碰撞 | 对应仿真器 |
| 机器人运行关联、命令校验和 Studio 侧诊断 | 主进程内最小 Robotics Run 服务 |
| Agent 会话与 Agent run | 现有 Agent Runtime |
| 页面进度和展示 | renderer 可丢弃投影 |

主进程 Robotics Run 服务只关联 Workspace、主机、远端 `runId`、任务版本和画面/数据端点，不复制远端进程账本或仿真世界。若引入非 CCLink 的直接网络 Runtime，需要在实现前复审现有架构宪法及 Terminal 网络边界；需要形成例外时先提交 ADR。

## 仿真与真机边界

首轮任务只接受 `target: simulation`。Runner 与任务定义不得借仿真入口访问真机网络接口或设备节点。

未来真机只读遥测、部署策略和实际运动控制分别验收。电机上使能、轨迹执行和动捕实时跟随必须明确选择真实设备，检查急停与现场条件，并由用户在受控入口授权。仿真无碰撞、策略推理完成或 Agent 判断正常都不能证明真机安全。

## 开发顺序候选

1. 配置一台 frp 可达的 Ubuntu 主机并完成只读能力探测。
2. Runner 完成单个推理任务的 `start/status/attach/stop` 和日志续接。
3. Studio 在真实 Workspace 启动 G1 推理并显示真实状态与日志。
4. 接入 Isaac WebRTC 或选定仿真器的画面通道。
5. 接入轨迹、碰撞和运行证据，完成首个端到端验收。
6. 增加后台训练、指标、checkpoint 和断线恢复。
7. 根据真实机械臂、动捕设备和工作流分别设计后续闭环；真机控制单独立项。

当前用户功能进度：尚不能在 Studio 中配置普通 frp Ubuntu 主机、启动机器人任务或查看远程仿真画面。当前工程准备度：已有 Workspace、Terminal、Browser、Agent 及 CCLink 远程 PTY 的部分基础，但普通 Robot Runner、画面通道和机器人运行契约均未实现。

## 实施前待确认

- Ubuntu GPU 型号、驱动、当前 Isaac/MuJoCo/ROS 版本及运行方式；
- frps 的部署位置、TLS、访问控制和 UDP 映射能力；
- 首个真实样例使用 Isaac 还是 MuJoCo，以及是否已经存在可运行的 G1 checkpoint；
- 训练进程使用 Conda、Docker 还是其他环境；
- 首轮轨迹、碰撞和日志分别从什么真实接口取得；
- 一个主机、Workspace 和 GPU 上需要支持的并发数量。
