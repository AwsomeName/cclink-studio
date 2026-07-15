# 硬件工作区与生产助手

> 状态：规划稿
> 最后更新：2026-07-15
> 关联文档：`docs/features/product-milestones.md`、`docs/features/fpc-shape-change-assistant.md`、`docs/features/cad-conversion-plugins.md`、`docs/features/browser-automation.md`、`docs/features/platform-automation.md`、`docs/features/project-system.md`

## 结论

硬件工作区是 CCLink Studio 面向 AI 眼镜、PCB、FPC、结构件和小批量生产项目的垂直工作流。

第一版不做“AI 自动画板”，也不承诺“AI 独立改电路并下单”。第一版做一个更真实、更安全、更容易验收的闭环：

```text
打开硬件项目目录
→ 自动识别原理图 / PCB 源工程 / Gerber / BOM / 坐标 / 结构件
→ 生成生产包检查报告
→ 帮用户定位缺失文件、版本混乱和下单风险
→ 打开嘉立创下单页并辅助上传、填参数、生成报价
→ 下单、付款、地址确认前必须人工确认
```

CCLink Studio 在硬件项目里的定位是“硬件生产副驾驶”，不是 EDA 的替代品。

FPC 外形调整是硬件工作区的第一个真实改版场景。它的产品边界、用户流程和分阶段方案见 `docs/features/fpc-shape-change-assistant.md`。

## 产品功能

### 1. 硬件项目识别

当用户打开工作空间时，CCLink Studio 扫描目录并识别硬件项目特征：

- 原理图：KiCad、嘉立创 EDA、Altium、PDF 原理图、图片原理图。
- PCB 源工程：KiCad PCB、嘉立创 EDA 工程、Altium PCBDoc。
- 生产输出：Gerber zip、钻孔文件、BOM、坐标文件、装配图、钢网文件。
- 结构件：STEP/STP、STL、3MF、DXF、外壳图纸。
- 固件和软件：MCU 固件、测试脚本、烧录说明。
- 数据手册：PDF datasheet、规格书、连接器手册。

识别结果以“硬件项目摘要”显示在 Sidebar 或主工作区：

```text
AI 眼镜右眼 FPC
├─ 源工程：未发现
├─ Gerber：1 个 zip
├─ BOM：1 个
├─ 坐标文件：1 个
├─ 结构件：未关联
└─ 风险：缺少源工程，后续只能做生产检查，不能可靠改板
```

### 2. 生产包检查

生产包检查是 MVP 的核心功能。

检查项：

- 文件完整性：Gerber、钻孔、BOM、坐标文件是否齐全。
- 版本一致性：文件名版本、目录版本、zip 内文件版本是否冲突。
- BOM/坐标一致性：位号数量、缺失位号、重复位号、封装字段是否异常。
- 下单准备度：是否区分 PCB 打样、SMT 贴片、FPC、钢网、结构件。
- 嘉立创参数建议：板厚、层数、阻焊颜色、表面处理、拼板、是否需要贴片。
- 风险提示：缺源工程、缺装配图、BOM 字段无法匹配商城、坐标方向不确定。

输出不是一句“可以下单”，而是结构化报告：

```text
结论：可生成报价，但不建议直接下单
原因：
- BOM 有 51 个位号，坐标文件只有 50 个位号，缺失 U3
- Gerber 文件名为 V4.0，BOM 文件名没有版本号
- 未发现装配方向图，FPC 连接器方向需要人工确认
下一步：
1. 补齐 U3 坐标或确认 U3 不贴
2. 将 BOM 文件名统一为 V4.0
3. 上传装配图后再进入嘉立创 SMT 流程
```

### 3. 生产文件预览

第一版预览不追求完整 EDA 编辑能力，优先做下单前判断需要的预览：

- Gerber 文件列表和层类型识别。
- Gerber zip 内单层原始文本预览。
- Gerber 常见线段/圆弧几何预览。
- Gerber 闭合外形候选、尺寸、面积和周长识别。
- Gerber 闭合结构初步分类：外轮廓、内孔、开槽、辅助线。
- BOM 表格预览、位号搜索、字段映射。
- 坐标文件预览、位号搜索、与 BOM 交叉高亮。
- STL/3MF/GLB/FBX 等轻量 3D 模型预览。
- STEP/STP 识别为结构件，但需要可选 CAD 转换插件后才能可靠预览。
- zip 包内容树。
- PDF/图片装配图预览。

后续再考虑完整 aperture/region 渲染、层叠预览和坐标点位叠加。

当前已实现 Gerber 层类型识别、单层文本预览、基础线段/圆弧 SVG 预览、闭合外形候选识别、基础角色分类、STL/3MF 模型预览、STEP/STP 识别、CAD 转换配置底座，以及结构件预览状态/metadata 进入硬件摘要；尚未实现完整 Gerber 图形渲染、层叠显示、几何编辑、真实 STEP 样本验收和结构件/FPC 装配坐标对齐。

### 4. 结构件与 CAD 转换

结构件能力服务两个场景：

- 用户自己查看光机、镜腿、连接件等外壳结构。
- AI 在 FPC 改形状时把结构件作为避让约束和装配参考。

格式分层：

| 格式         | 默认支持 | 说明                                        |
| ------------ | -------- | ------------------------------------------- |
| STL          | 是       | 直接 Three.js 渲染，适合快速看形状          |
| 3MF          | 是       | 直接 Three.js 渲染，适合 3D 打印/结构件预览 |
| GLB/GLTF/FBX | 是       | 通用 mesh/模型预览                          |
| STEP/STP     | 否       | CAD B-Rep，需要可选 CAD 转换插件            |

STEP/STP 不作为默认功能打包，原因是 FreeCAD 体积大、OpenCascade 集成复杂，而且 STEP 转 mesh 失败时必须给结构化诊断。

详细方案和开发里程碑见 `docs/features/cad-conversion-plugins.md`。

### 5. 电路调试助手

调试助手面向真实硬件故障，但必须明确输入依赖。

用户需要给 CCLink Studio：

- 故障现象：不开机、过流、发热、无法识别 USB、摄像头无图等。
- 测量值：电压、电流、波形、阻值、二极管档读数。
- 实物照片：正反面、局部焊接、连接器方向。
- 原理图或关键芯片资料。
- 已做过的排查步骤。

CCLink Studio 输出：

- 排查树：先查电源、再查时钟、再查复位、再查总线。
- 测量点建议：测哪里、期望值是多少、异常意味着什么。
- 可能原因排序：焊接、短路、器件方向、设计错误、物料替代。
- 修改建议草案：换阻值、加上拉、改线序、加保护、改封装。

边界：

- 没有源工程时，不自动改 Gerber。
- 没有测量数据时，只能给假设和排查路径。
- 涉及高压、锂电池、激光、射频和佩戴安全时，必须提示人工专业确认。

### 6. 电路板修改

改板能力按源工程类型分阶段。

第一优先级是 KiCad，因为文件格式开放、可读写、适合自动化 diff。

第二优先级是嘉立创 EDA，因为它和打样链路最短，但需要确认文件格式和网页编辑能力。

Altium 只做读取和外部打开，不在早期承诺自动写回。

修改流程必须是：

```text
读取源工程
→ 生成修改建议
→ 创建修改草案
→ 显示 diff / 变更摘要
→ 用户确认
→ 写入副本或新版本目录
→ 重新生成生产检查报告
```

禁止：

- 直接覆盖用户唯一源工程。
- 没有 diff 就写板。
- 自动提交下单。
- 把 Gerber 当作可靠的主要编辑源。

### 7. 嘉立创打样下单助手

嘉立创助手复用现有 Browser 自动化和平台自动化原则。

支持动作：

- 读取生产包检查结果。
- 打开嘉立创或嘉立创 EDA 下单入口。
- 使用项目绑定浏览器 profile。
- 上传 Gerber zip、BOM、坐标文件。
- 根据检查报告预填板厚、数量、颜色、工艺等参数。
- 生成报价页并截图留档。
- 将报价、参数和截图写回项目记录。

必须人工确认：

- 提交订单。
- 付款。
- 修改收货地址。
- 选择替代物料。
- 接受高风险 DFM 提示。

项目记录建议写入：

```text
hardware/orders/2026-07-14-jlc-v4.0.md
```

记录内容：

- 上传文件路径和 hash。
- 下单参数。
- 报价金额。
- 页面截图。
- 用户确认项。
- 失败原因和下一步。

## 信息架构

硬件项目不是新的顶层工作空间类型，而是当前工作空间的一种能力视图。

```text
工作空间
├─ 文件
├─ 会话
├─ 硬件
│  ├─ 项目摘要
│  ├─ 生产包
│  ├─ BOM / 坐标
│  ├─ 调试记录
│  └─ 打样订单
└─ 浏览器 / 文档 / 预览 Tab
```

Activity Bar 不新增“硬件”一级入口。硬件能力在工作空间 Sidebar 内根据项目识别结果出现，避免左侧入口继续膨胀。

## 代码架构

### 主进程模块

新增领域模块：

```text
src/main/hardware/
├─ hardware-project-detector.ts      # 硬件项目识别
├─ hardware-artifact-index.ts        # 产物索引与分类
├─ production-package-service.ts     # 生产包检查
├─ bom-parser.ts                     # BOM 解析
├─ centroid-parser.ts                # 坐标文件解析
├─ gerber-package-inspector.ts       # Gerber zip 结构检查
├─ hardware-order-record-service.ts  # 打样记录写入
└─ types.ts
```

职责边界：

- `hardware/` 只做本地文件识别、解析、校验和记录。
- 不直接操控浏览器。
- 不直接调用 Agent。
- 不依赖 React store。

### IPC 与 preload

新增 IPC：

```text
src/main/ipc/hardware-ipc.ts
src/shared/ipc/hardware.ts
src/preload/index.ts
```

暴露给渲染进程的 API：

```typescript
window.deepink.hardware.scanWorkspace(workspaceRef)
window.deepink.hardware.inspectProductionPackage(input)
window.deepink.hardware.parseBom(path)
window.deepink.hardware.parseCentroid(path)
window.deepink.hardware.createOrderRecord(input)
```

所有文件读写仍然经主进程完成，保持 Electron 安全边界。

### MCP 工具模块

新增 Agent 工具模块：

```text
src/main/mcp/modules/hardware/index.ts
```

第一批工具：

- `hardware_scan_project`
- `hardware_inspect_production_package`
- `hardware_read_bom`
- `hardware_read_centroid`
- `hardware_create_order_record`
- `hardware_prepare_jlc_order_context`

工具只返回结构化结果和建议，不直接点击下单按钮。嘉立创网页操作继续走 browser MCP 工具，硬件模块只负责给 browser 任务提供上下文。

### 渲染进程

新增功能目录：

```text
src/renderer/src/features/hardware/
├─ hardware-types.ts
├─ hardware-view-model.ts
├─ hardware-report-format.ts
└─ hardware-risk-level.ts
```

新增组件：

```text
src/renderer/src/components/hardware/
├─ HardwareSummary.tsx
├─ ProductionPackageReport.tsx
├─ BomTablePreview.tsx
├─ CentroidTablePreview.tsx
├─ HardwareOrderRecordPanel.tsx
└─ HardwareActionBar.tsx
```

Zustand store：

```text
src/renderer/src/stores/hardware-store.ts
```

store 只保存当前工作空间的扫描结果、检查状态、选中文件和报告缓存，不保存大文件内容。

### Tab 类型

在现有 Tab 体系内增加硬件预览类 Tab：

```typescript
type HardwareTab =
  | { type: 'hardware-summary'; workspaceKey: string }
  | { type: 'hardware-production-report'; reportId: string }
  | { type: 'hardware-bom-preview'; path: string }
  | { type: 'hardware-order-record'; path: string }
```

不要新增独立窗口，不要让硬件工作区绕开 Workbench。

### 数据模型

核心类型：

```typescript
type HardwareArtifactType =
  | 'schematic'
  | 'pcb-source'
  | 'gerber-package'
  | 'bom'
  | 'centroid'
  | 'drill'
  | 'assembly-drawing'
  | 'enclosure'
  | 'firmware'
  | 'datasheet'
  | 'unknown'

interface HardwareArtifact {
  id: string
  type: HardwareArtifactType
  path: string
  displayName: string
  version?: string
  confidence: number
  metadata: Record<string, unknown>
}

interface ProductionPackageReport {
  id: string
  workspaceKey: string
  createdAt: string
  conclusion: 'ready' | 'quote-only' | 'blocked'
  risks: HardwareRisk[]
  artifacts: HardwareArtifact[]
  suggestedJlcParams: Record<string, unknown>
}

interface HardwareRisk {
  level: 'info' | 'warning' | 'blocking'
  title: string
  detail: string
  artifactIds: string[]
  nextAction: string
}
```

## 权限与安全

低风险动作可自动执行：

- 扫描工作空间。
- 读取 Gerber zip 目录结构。
- 解析 BOM 和坐标文件。
- 生成检查报告。
- 打开嘉立创网站。
- 填写草稿参数。
- 写入本地订单记录草稿。

高风险动作必须确认：

- 修改源工程。
- 生成新版生产包。
- 上传生产文件到第三方网站。
- 接受 DFM 风险。
- 提交订单。
- 付款。
- 修改收货地址。

确认卡片必须显示：

- 项目名称和版本。
- 将要上传的文件路径。
- 文件 hash。
- 目标网站。
- 订单参数。
- 风险摘要。

## 开发里程碑

### M8.1：硬件项目识别

目标：打开 AI 眼镜目录后，CCLink Studio 能识别这是硬件项目，并列出关键产物。

实现：

- 新增 `src/main/hardware` 基础模块。
- 扫描文件名、扩展名、zip 内容和目录结构。
- 在工作空间 Sidebar 内展示“硬件项目摘要”入口。

验收：

- 能识别 Gerber zip、BOM、坐标文件、结构件、datasheet。
- 能标记“缺少源工程”“有生产包但不能可靠改板”。
- 扫描失败不会影响普通文件树。

### M8.2：生产包检查报告

目标：对 Gerber/BOM/坐标文件做下单前检查。

实现：

- 解析常见 BOM：csv、xlsx、tsv。
- 解析常见坐标文件：csv、xlsx、txt。
- 检查 BOM 和坐标位号一致性。
- 检查 Gerber zip 基础结构。
- 输出结构化 `ProductionPackageReport`。

验收：

- 对当前 AI 眼镜目录能生成报告。
- 报告能区分 `ready`、`quote-only`、`blocked`。
- 风险项能定位到具体文件和位号。

### M8.3：硬件报告 UI 与 Agent 工具

目标：用户和 Agent 都能消费同一份检查结果。

实现：

- 新增硬件报告 Tab。
- 新增 BOM/坐标预览组件。
- 新增 hardware MCP 工具。
- Agent 可以基于报告回答“现在能不能下单，缺什么”。

验收：

- UI 中能查看报告、风险和建议下一步。
- Agent 能调用 `hardware_inspect_production_package`。
- 检查报告可保存到项目 Markdown。

### M8.4：结构件预览与 CAD 转换插件

目标：让用户能查看外壳/光机/连接件结构，并让 AI 在 FPC 改形状时把结构件作为参考约束。

实现：

- STL/3MF/GLB/FBX 继续走内置 `ModelViewer`。
- STEP/STP 进入可选 CAD 转换流程，不默认打包 FreeCAD/OpenCascade。
- 设置页新增“硬件与 CAD”分组：
  - 查看 STEP/STP 支持状态。
  - 绑定本机 FreeCAD 路径。
  - 检测后端版本。
  - 清理转换缓存。
- 主进程新增 `cad` 模块：
  - 后端检测。
  - STEP 转换任务。
  - 预览 mesh 缓存。
  - 结构件 metadata 缓存。
  - 结构化错误诊断。
- 硬件摘要和生产报告新增 `structuralArtifacts`：
  - 文件路径和扩展名。
  - 是否可预览。
  - 是否需要 CAD 后端。
  - 是否命中 metadata 缓存。
  - 包围盒尺寸和单位置信度。

验收：

- 当前 AI 眼镜目录能识别 STEP、STL、3MF 结构件。
- STL/3MF 可直接打开并渲染。
- STEP 未启用插件时显示“需要 CAD 转换插件”，而不是普通加载失败。
- 用户配置本机 FreeCAD 后，STEP 能转换为可预览 mesh。
- 第二次打开同一 STEP 命中缓存。
- 转换失败能给出结构化原因和下一步。
- `hardware_scan_project` / `hardware_inspect_production_package` 能返回结构件预览状态和已缓存尺寸 metadata。
- `hardware_prepare_fpc_shape_context` 能返回 FPC 改形状前的只读上下文包：
  - 外形层候选摘要。
  - 结构件预览状态和尺寸 metadata。
  - 需要用户补充的装配对齐问题。
  - 下一步建议。

详细拆分见 `docs/features/cad-conversion-plugins.md`。

### M8.5：嘉立创报价助手

目标：让 CCLink Studio 帮用户走到嘉立创报价页，但不自动提交订单。

实现：

- 为硬件项目支持 `deepink-hardware.json` 配置：

```json
{
  "version": 1,
  "platforms": [
    {
      "id": "jlc",
      "name": "嘉立创",
      "url": "https://www.jlc.com",
      "browserProfile": "jlc-ai-glasses",
      "notes": "付款和提交订单前必须人工确认。"
    }
  ]
}
```

- 生成嘉立创下单上下文。
- 使用 browser MCP 上传文件、填写草稿参数、截图报价。
- 写入 `hardware/orders/*.md`。

验收：

- 能从检查报告进入嘉立创报价流程。
- 能保留登录态和报价现场。
- 提交订单、付款、地址确认前一定弹确认。

### M8.6：调试助手

目标：支持基于故障现象、测量值和项目文件生成排查路径。

实现：

- 新增调试记录模板。
- 支持用户上传照片、记录测量点和测量值。
- Agent 基于生产包、datasheet 和测量值生成排查树。

验收：

- 能对“不开机 / USB 不识别 / 摄像头无图 / FPC 接触不良”等问题给出排查路径。
- 输出必须包含假设、测量点、期望值和下一步。
- 没有测量数据时，明确标记为假设而不是结论。

### M8.7：EDA 源工程改板试点

目标：只对开放格式源工程做受控改板试点。

实现：

- KiCad 源工程读取。
- 生成修改草案和 diff。
- 写入新版本目录，不覆盖原工程。
- 修改后重新运行生产包检查。

验收：

- 能对简单改动生成可审查 diff。
- 用户确认前不写入。
- 不能把 Gerber 编辑伪装成可靠改板。

## 拷问

如果第一版不能帮用户在嘉立创生成一次可靠报价，它就没有击中真实生产痛点。

如果第一版承诺自动改板和自动下单，它就越过了安全边界，风险会比价值更早爆炸。

如果硬件能力做成新的顶层 App，而不是工作空间内的能力视图，CCLink Studio 的信息架构会再次变乱。

如果没有源工程，CCLink Studio 只能做生产检查和调试辅助，不能假装自己能可靠修改电路板。

下一步最该做 M8.1 和 M8.2：先让当前 AI 眼镜目录被识别、被检查、能生成一份有用的生产风险报告。结构件路线并行从 M8.4 的 FreeCAD 本机适配开始，不先做托管下载和 OpenCascade。
