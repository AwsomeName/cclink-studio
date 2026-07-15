# CAD 转换插件与 STEP 预览

> 状态：规划稿
> 最后更新：2026-07-15
> 关联文档：`docs/features/hardware-workspace.md`、`docs/features/fpc-shape-change-assistant.md`、`docs/features/product-milestones.md`

## 结论

STEP/STP 支持不应作为 CCLink Studio 默认内置功能直接打包。

正确产品形态是：

```text
默认内置轻量 3D 预览
→ 用户在设置页启用 CAD 转换能力
→ CCLink Studio 检测或下载转换后端
→ STEP/STP 转为可预览 mesh
→ ModelViewer 继续负责交互式渲染
```

这样做的原因：

- FreeCAD 体积大、启动慢、跨平台路径差异明显，不适合放进默认包体。
- OpenCascade/OCCT 更适合作为长期几何内核，但工程集成和容错成本高。
- STEP 是 CAD B-Rep，不是 mesh；直接“解析一点然后画出来”很容易给用户错误信心。
- AI 眼镜/FPC 场景需要的是可靠结构约束，不是漂亮但不准的截图。

## 产品目标

让 CCLink Studio 在硬件项目中逐步支持结构件文件：

- 默认能打开 STL、3MF、GLB、GLTF、FBX 等 mesh 格式。
- 启用 CAD 转换插件后能预览 STEP/STP。
- 后续让 AI 能读取结构件尺寸、包围盒、关键面、装配避让区域。
- 更后续才考虑 CAD 级编辑、布尔运算、截面分析和干涉检查。

当前不承诺：

- 不承诺直接编辑 STEP 源文件。
- 不承诺还原参数化建模历史。
- 不承诺替代 Fusion 360、SolidWorks、FreeCAD 或专业机械工程师。

## 能力边界

### 默认内置能力

内置能力只处理轻量预览，不触发额外下载：

- STL：直接 Three.js `STLLoader` 渲染。
- 3MF：直接 Three.js `ThreeMFLoader` 渲染。
- GLB/GLTF/FBX：继续走现有 `ModelViewer`。
- STEP/STP：识别为模型文件，但提示需要 CAD 转换插件。

### 可选 CAD 转换能力

启用后支持：

- 检测本机 FreeCAD。
- 用户手动选择 FreeCAD 可执行文件路径。
- 将 STEP/STP 转为临时 GLB/STL/OBJ。
- 缓存转换结果，避免每次打开都重新转换。
- 给出结构化诊断：缺少后端、转换失败、文件损坏、单位不确定、导出为空等。

后续支持：

- 下载托管的转换运行时。
- OpenCascade/OCCT 后端。
- 转换任务队列、取消、进度显示。
- 几何元数据提取：尺寸、包围盒、体积、面片数、单位、装配坐标。

## 产品交互

### 设置页

新增设置分组：

```text
设置
└─ 硬件与 CAD
   ├─ 3D 模型预览
   │  ├─ STL/3MF/GLB/FBX：已内置
   │  └─ STEP/STP：未启用 / 已启用 / 需要修复
   ├─ CAD 转换后端
   │  ├─ 关闭
   │  ├─ 使用本机 FreeCAD
   │  ├─ 下载 CCLink Studio 托管转换器
   │  └─ 高级：OpenCascade 实验后端
   ├─ FreeCAD 路径
   ├─ 检测后端
   ├─ 转换缓存位置
   └─ 清理缓存
```

### 文件打开

用户打开 STEP/STP 时：

```text
如果 CAD 转换未启用：
  显示“启用 STEP 预览”行动按钮
  跳转设置页对应分组

如果已配置后端：
  创建转换任务
  展示进度
  转换成功后打开 ModelViewer
  转换失败展示结构化错误和修复建议
```

### 硬件工作区

结构件作为硬件产物进入项目摘要：

```text
结构件
├─ 光机左镜框精简.STEP：需要 CAD 转换插件
├─ 光机左镜腿小盖板beta01.STL：可直接预览
└─ 蓝牙镜腿连接件.3mf：可直接预览
```

AI 在 FPC 改版流程里可以引用结构件：

```text
用户：尾巴往右边伸，但不要撞到镜腿连接件。
AI：先打开 3MF 结构件和 FPC 外形，提取包围盒，要求用户标注装配坐标或补充对齐点。
```

## 架构方案

### 模块边界

```text
src/main/cad/
├─ cad-conversion-service.ts        # 转换任务编排
├─ cad-backend-registry.ts          # 后端注册与选择
├─ backends/
│  ├─ freecad-backend.ts            # 本机 FreeCAD CLI
│  ├─ managed-freecad-backend.ts    # 托管下载运行时
│  └─ occt-backend.ts               # OpenCascade 实验后端
├─ cad-cache-store.ts               # 预览 mesh 缓存
├─ cad-diagnostics.ts               # 后端检测与错误分类
└─ types.ts

src/shared/ipc/cad.ts               # IPC contract
src/main/ipc/cad-ipc.ts             # 主进程 IPC handler
src/main/mcp/modules/cad/index.ts   # Agent 工具
src/renderer/src/components/settings/CadSettings.tsx
```

原则：

- 转换只在主进程执行。
- renderer 不直接 spawn 后端进程。
- ModelViewer 不关心后端，只接收可预览 mesh 路径。
- 失败必须结构化，不靠字符串猜原因。
- 默认不下载任何东西，必须用户显式启用。

### 类型草案

```typescript
type CadBackendKind = 'none' | 'local-freecad' | 'managed-freecad' | 'occt-experimental'

interface CadConversionSettings {
  cadBackend: CadBackendKind
  freecadPath?: string
  managedRuntimeVersion?: string
  cacheEnabled: boolean
  cacheLimitMb: number
}

interface CadBackendStatus {
  kind: CadBackendKind
  available: boolean
  version?: string
  path?: string
  error?: CadConversionError
}

interface CadConvertRequest {
  inputPath: string
  targetFormat: 'glb' | 'stl' | 'obj'
  force?: boolean
}

interface CadConvertResult {
  success: boolean
  previewPath?: string
  format?: 'glb' | 'stl' | 'obj'
  sourceHash?: string
  diagnostics: CadDiagnostic[]
  error?: CadConversionError
}
```

### FreeCAD 后端

第一阶段优先做 FreeCAD，因为它能最快验证真实 STEP 预览价值。

实现方式：

```text
FreeCADCmd / FreeCAD --console
→ 执行受控 Python 脚本
→ Import STEP
→ Mesh/Part 导出 STL 或 OBJ
→ CCLink Studio 读取导出文件并交给 ModelViewer
```

要求：

- 不执行用户项目目录里的任意脚本。
- 转换脚本由 CCLink Studio 内置生成。
- 输入输出路径必须经过 allowlist 校验。
- 超时可取消。
- stdout/stderr 写入诊断日志。

### 托管下载后端

第二阶段实现。

用户点击“下载 STEP 支持”后：

- 下载固定版本转换运行时到 `userData/cad-runtimes/`。
- 校验 hash。
- 记录版本。
- 支持删除运行时。
- 更新时不影响已有默认功能。

不建议第一阶段就做自动下载，因为需要处理签名、断点续传、代理、空间不足、版本升级和卸载。

### OpenCascade/OCCT 后端

第三阶段评估。

使用场景：

- 更快的本地转换。
- 更细的 B-Rep 元数据。
- 后续几何分析、截面、面选择、干涉检查。

风险：

- 集成复杂。
- WASM 包体和内存占用需要压测。
- STEP 文件容错和单位处理需要真实样本验证。

## 开发里程碑

每个里程碑都必须能单独验收，不能用“后面插件系统会补上”糊过去。

### 2026-07-15 实施记录

已启动 CAD 插件路线的第一段：

- `CAD-M1` 已打底：`AppSettings` 新增 `cadBackend`、`freecadPath`、`cadCacheEnabled`、`cadCacheLimitMb`，设置页新增“硬件与 CAD”分组。
- `CAD-M2` 已打底：主进程新增本机 FreeCAD/FreeCADCmd 检测，支持配置路径、macOS 常见路径和 shell PATH。
- `CAD-M3` 已打底：主进程新增 CAD 转换服务，第一版支持 STEP/STP 通过本机 FreeCAD 转为 STL 预览文件，并按源文件 hash 写入 `userData/cad-cache/`。
- `CAD-M4` 已打底：ModelViewer 打开 STEP/STP 时会走 CAD 转换服务；未启用或转换失败时显示结构化错误，不再只给静态“暂不支持”文案。
- `CAD-M4.1` 已打底：CAD IPC 增加 `getModelSupport`、`getCacheStatus`、`clearCache`，设置页可查看缓存占用、缓存目录并清理缓存。
- `CAD-M5` 已打底：`hardware_scan_project` 和 `hardware_inspect_production_package` 会返回 `structuralArtifacts`，让结构件预览状态、缓存命中和尺寸 metadata 进入硬件项目上下文。
- `CAD-M6` 已打底第一段：ModelViewer 会展示预览 mesh 的包围盒尺寸；STEP/STP 转换成功后会在 `metadata.json` 中持久化包围盒、单位置信度、预览路径和源文件 hash。
- `CAD-M6.1` 已打底：新增 CAD MCP 只读诊断工具，Agent 可查询 CAD 后端状态、模型支持情况、已缓存结构 metadata 和缓存状态；清缓存工具只删除 CCLink Studio 生成的预览缓存。

尚未完成：

- 托管 FreeCAD 运行时下载。
- OpenCascade/OCCT 实验后端。
- 转换任务取消、进度百分比和诊断复制。
- 结构件/FPC 坐标对齐、干涉检查和可写 CAD/FPC 修改工具。
- 真实 AI 眼镜 STEP 样本的 FreeCAD 转换验收。

### CAD-M0：文档与产品边界

目标：明确 STEP 支持不是默认功能，而是可选 CAD 转换能力。

怎么做：

- 新增本文档。
- 在硬件工作区、FPC 改版助手、产品里程碑中引用。
- 明确 FreeCAD、托管运行时、OpenCascade 的顺序。
- 明确默认内置格式和可选格式。

验收标准：

- 文档能回答：为什么不默认打包 FreeCAD。
- 文档能回答：STEP 打不开时用户看到什么。
- 文档能回答：第一阶段做什么、不做什么。
- 文档能回答：后续 AI 改 FPC 如何使用结构件。

### CAD-M1：设置模型与能力状态

目标：让 CCLink Studio 有“CAD 转换能力”的配置和状态。

怎么做：

- 扩展 `AppSettings`：
  - `cadBackend`
  - `freecadPath`
  - `cadCacheEnabled`
  - `cadCacheLimitMb`
- 增加设置校验枚举。
- 新增 `CadBackendStatus` IPC：
  - 检测未配置。
  - 检测用户配置路径是否存在。
  - 读取 FreeCAD 版本。
- 设置页新增“硬件与 CAD”分组。

验收标准：

- 设置页能看到 STEP/STP 支持状态。
- 用户能选择 FreeCAD 路径。
- 设置能持久化，重启后仍生效。
- 无 FreeCAD 时状态显示“未启用”，不影响 STL/3MF 预览。
- 错误路径显示“需要修复”，不崩溃。

### CAD-M2：本机 FreeCAD 检测

目标：不用下载，先支持用户本机已有 FreeCAD。

怎么做：

- 实现 `freecad-backend.detect()`。
- macOS 优先扫描：
  - 用户配置路径。
  - `/Applications/FreeCAD.app/...`
  - shell PATH 中的 `FreeCADCmd` / `freecadcmd`。
- 预留 Windows/Linux 路径策略。
- 输出结构化状态和诊断。

验收标准：

- 用户本机有 FreeCAD 时能检测到版本。
- 用户本机没有 FreeCAD 时给出可理解提示。
- 配置错误路径时有结构化错误码。
- 检测过程不阻塞 UI。

### CAD-M3：STEP 到预览 mesh 转换

目标：用户打开 STEP/STP 后能生成可预览文件。

怎么做：

- 新增 `CadConversionService.convert()`。
- 对输入文件计算 hash。
- 创建缓存目录：
  - `userData/cad-cache/<hash>/preview.glb|stl|obj`
- 调用 FreeCAD 受控脚本导入 STEP 并导出 STL 或 OBJ。
- 转换成功后返回 `previewPath`。
- ModelViewer 收到 `previewPath` 后复用现有 mesh 渲染。

验收标准：

- 打开真实 AI 眼镜 STEP 文件能生成预览 mesh。
- 生成结果可在 ModelViewer 里旋转、缩放、重置视角。
- 转换日志可查看。
- 第二次打开同一文件命中缓存。
- 文件损坏、导出为空、超时都有结构化错误。

### CAD-M4：STEP 打开体验收口

目标：把“模型加载失败”变成可操作的产品流程。

怎么做：

- ModelViewer 对 `.step/.stp`：
  - 未启用：显示“启用 STEP 预览”。
  - 后端可用：显示转换进度。
  - 失败：显示错误原因和修复动作。
- 新增跳转设置页对应分组。
- 转换任务支持取消。
- CAD API 提供：
  - `getModelSupport(inputPath)`
  - `getCacheStatus()`
  - `clearCache()`

验收标准：

- 用户打开 STEP 时不再只看到静态报错。
- 未启用状态可以一键去设置。
- 转换中有进度/忙碌态。
- 失败后能复制诊断信息。
- 取消转换不会留下半成品 Tab 卡死。
- 设置页能显示转换缓存路径、占用和清理按钮。

### CAD-M5：硬件工作区结构件集成

目标：让结构件成为 FPC 改形状流程的一等上下文。

怎么做：

- 硬件扫描识别 `.step/.stp/.stl/.3mf/.dxf` 为结构件。
- 在硬件摘要里展示预览能力状态：
  - 可直接预览。
  - 需要 CAD 插件。
  - 已缓存预览。
  - 转换失败。
- Agent 工具能读取结构件摘要和预览状态。
- 生产报告写入结构件/CAD 约束摘要。
- `hardware_prepare_fpc_shape_context` 把结构件摘要、外形候选和装配对齐问题合成 FPC 改形状上下文包。

验收标准：

- 当前 AI 眼镜目录能列出三个结构件文件。
- STL/3MF 显示可直接预览。
- STEP 在未启用插件时显示需要启用。
- 启用 FreeCAD 后 STEP 显示可转换/已缓存。
- Agent 能回答“哪些结构件可用于 FPC 避让参考”。
- 生产报告能列出结构件是否可预览、是否需要后端、是否已有尺寸 metadata。
- Agent 能拿到“还缺哪些对齐信息”的问题清单，而不是直接推断干涉。

### CAD-M6：几何元数据提取

目标：从“能看”进入“AI 能用”。

怎么做：

- 对转换后的 mesh 计算：
  - 包围盒。
  - 尺寸。
  - 三角面数。
  - 近似体积。
  - 坐标原点和单位推断。
- 保存到缓存 metadata。
- 在 ModelViewer toolbar 显示尺寸。
- Agent 工具读取 metadata。
- Agent 工具先暴露：
  - `cad_get_backend_status`
  - `cad_get_model_support`
  - `cad_inspect_model`
  - `cad_get_cache_status`
  - `cad_clear_cache`

验收标准：

- 用户能看到结构件大致尺寸。
- Agent 能引用结构件尺寸做解释。
- 如果单位不确定，必须显示“单位待确认”。
- 元数据缓存与源文件 hash 绑定。
- 第一阶段允许尺寸来自 FreeCAD/预览 mesh；后续必须补更严格的 CAD 单位识别、装配坐标和对齐关系。

### CAD-M7：托管下载运行时

目标：用户没有 FreeCAD 也能启用 STEP 支持。

怎么做：

- 新增托管运行时 manifest。
- 设置页显示下载大小、版本、磁盘占用。
- 下载到 `userData/cad-runtimes/`。
- 校验 hash。
- 支持删除运行时。

验收标准：

- 用户点击启用后能下载运行时。
- 下载失败可重试。
- hash 不匹配时拒绝使用。
- 删除运行时后 STEP 支持回到未启用。
- 默认安装包体不显著增加。

### CAD-M8：OpenCascade 实验后端

目标：验证是否值得用 OCCT 替代或补充 FreeCAD。

怎么做：

- 增加实验开关。
- 实现最小 STEP 导入和 mesh 导出。
- 与 FreeCAD 转换结果做尺寸、面片数、耗时对比。
- 记录内存和大文件表现。

验收标准：

- 至少 10 个真实 STEP 样本完成 FreeCAD/OCCT 对比。
- 能证明 OCCT 在速度、稳定性或元数据上有明显收益。
- 如果收益不明显，保留 FreeCAD 路线，不强推 OCCT。

### CAD-M9：结构约束辅助 FPC 改版

目标：让结构件真正进入“AI 带我改 FPC”的主流程。

怎么做：

- 支持用户把结构件和 FPC 外形放到同一个审查任务。
- 允许用户标注对齐点或参考尺寸。
- AI 生成结构化避让约束：

```typescript
interface MechanicalConstraint {
  sourceFile: string
  kind: 'bounding-box' | 'keepout' | 'mounting-hole' | 'connector-envelope'
  boundsMm?: { x: number; y: number; z?: number; width: number; height: number; depth?: number }
  confidence: number
  needsUserAlignment: boolean
}
```

验收标准：

- 用户能说“避开这个结构件”，AI 能要求必要的对齐信息。
- AI 不会假装知道装配坐标。
- FPC 改版意图能引用结构约束。
- 生成修改草案前必须展示约束和不确定性。

## 风险与拷问

### 风险 1：插件名义，实际还是默认依赖

如果主包仍然硬依赖 FreeCAD 或巨大 WASM，插件化就失败了。

验收时必须检查默认安装包体、启动耗时和无插件状态。

### 风险 2：只做渲染，不做诊断

STEP 转换失败很常见。如果只显示“加载失败”，用户还是不知道下一步。

必须有结构化错误：

- backend-not-configured
- backend-not-found
- backend-version-unsupported
- conversion-timeout
- conversion-empty-output
- source-file-invalid
- unit-unknown

### 风险 3：AI 误用 mesh 当 CAD 真相

mesh 预览是近似结果，不能等同原始 CAD。

AI 必须知道：

- mesh 可用于视觉预览、包围盒、粗略尺寸。
- 不可用于可靠编辑 STEP 源文件。
- 不可推断原始建模参数。

### 风险 4：装配坐标缺失

结构件和 FPC 不一定在同一个坐标系。

如果没有装配约束或对齐点，AI 只能提示用户标注，不能直接判断“会不会撞”。

### 下一步最该做什么

先做 `CAD-M1 + CAD-M2 + CAD-M3`。

不要先做托管下载，也不要先做 OpenCascade。第一闭环是：

```text
用户本机装了 FreeCAD
→ CCLink Studio 设置页检测到
→ 打开真实 STEP
→ 转换成 mesh
→ ModelViewer 能看
→ 硬件摘要知道这个结构件可用于参考
```
