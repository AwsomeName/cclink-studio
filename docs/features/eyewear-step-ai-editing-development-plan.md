# 眼镜 STEP AI 修改：开发与验收记录

> 状态：P0、E0、M1 最小闭环已完成；路径、固定区域、BOP、规划取消已加固，真实 FreeCAD 扩展矩阵通过。最后更新：2026-10-09。
> 产品事实源：[眼镜 STEP AI 简单修改](./eyewear-step-ai-editing.md)
> 真实样本：`/Users/apple/Desktop/生产/外壳结构/20260716/光机左镜框精简20260716.STEP`

## 用户功能进度

用户现在可以在 Studio 中打开真实 STEP，让本地 Agent 规划一次受限的截面插入式加长或加宽，确认完整参数快照，生成新 STEP 副本，并自动打开新版查看结构化核验结果。

真实应用已经完成以下验收动作：

1. 打开真实左镜框 STEP，模型和预览网格包围盒可见；
2. 发出“X 正方向加长 3 mm、固定 min 端”的自然语言指令；
3. Agent 先调用 `cad_plan_modification`；
4. Studio 显示源哈希、操作、轴、方向、距离、截面、固定端、输出路径、预期尺寸和可制造性边界；
5. 用户只能选择本次“允许”或“拒绝”；
6. 允许后，`cad_modify_step` 生成新的 STEP，不覆盖原文件；
7. 输出重新导入并通过实体、体积、基础 B-Rep、完整 BOP 解析与基线策略、目标尺寸、固定区域和非目标轴门禁；
8. Studio 自动新增、选中并显示输出模型标签页；
9. Agent 结果卡显示输入、输出、尺寸、实体、面数、体积、完整性和基线警告。

当前验收输出为：

`/Users/apple/Desktop/生产/外壳结构/20260716/光机左镜框精简20260716-X加长3mm-AI-验收2.STEP`

## 工程准备度

| 阶段             | 类型     | 状态 | 退出证据                                                        |
| ---------------- | -------- | ---- | --------------------------------------------------------------- |
| P0 STEP 查看     | 用户功能 | 完成 | 真实 Electron 首次转换、缓存重开、模型交互和权限负向检查通过    |
| E0 修改可行性    | 工程准备 | 完成 | 真实样本连续三次得到相同实体、体积、尺寸和完整性结论            |
| M1 AI 单操作闭环 | 用户功能 | 完成 | 真实 Agent 规划、强制确认、生成、核验、结果卡和自动打开全部通过 |

## 最终范围

本轮只交付：

```text
查看真实 STEP
→ AI 规划一种已验证的 section-insert
→ 强制确认完整参数快照
→ FreeCADCmd 修改副本
→ 自动核验
→ 实时成功结果自动打开
```

不包含选面、装配、干涉、并排对比、版本数据库、实物反馈、多种修改操作、多编辑后端或制造判断。

## P0：STEP 查看与权限

### 实现结果

- renderer 不再通过通用文件 API 直接读取 `userData/cad-cache`；
- 主进程在转换前通过现有 `FileService.withAccess({ rendererId })` 和 `assertReadableFile` 验证源文件；
- `CadConversionService` 为每次授权签发不透明 `previewRef`；
- 引用绑定 renderer、工作空间真实根路径、源真实路径、源哈希、缓存格式、元数据和大小；
- 工作空间切换、renderer 变化、源哈希变化、缓存越界或缓存缺失时拒绝；
- `ModelViewer` 通过专用 CAD IPC 读取预览；
- 工作空间外 `convertModel` 和通用文件 API 读取 CAD 缓存均被拒绝。

### 真实验收

- 原模型显示 1 个对象、17,034 个渲染顶点、5,678 个三角形；
- 三角化预览网格包围盒约 `148.17 × 41.06 × 50.59 mm`；
- 删除缓存后首次转换成功；关闭并重开后缓存命中成功；
- 网格、线框、旋转、缩放和重置视角可用。

查看器现在明确把 STEP 标题栏尺寸标为“预览网格包围盒 ≈”。精确修改核验使用重新导入 STEP 的 B-Rep 包围盒，避免把显示网格当成工程实体。

## E0：真实样本修改可行性

### 后端

- FreeCAD 1.1.4；
- 命令行入口：`/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd`；
- 编辑能力独立探测 `FreeCADCmd`，不复用受预览设置影响的 `CadConversionService.getBackendStatus()`；
- 版本探测只保留受限的 `FreeCAD …` 行，不回传任意子进程环境输出。

### 冻结操作

- `operation`: `section-insert`；
- `axis`: `x`；
- `direction`: `positive`；
- `distanceMm`: `3`；
- `splitPlane`: `3.7637202218503205`；
- `fixedSide`: `min`。

该截面把源实体切成低侧 1 个 solid、高侧 1 个 solid，识别到 1 个接口面，面积约 `105.53 mm²`。

### 结果

| 指标                    |          源模型 |        输出模型 |
| ----------------------- | --------------: | --------------: |
| STEP 对象               |               1 |               1 |
| solid                   |               1 |               1 |
| 面数                    |             193 |             210 |
| 闭合 / valid / 基础检查 |            通过 |            通过 |
| X 尺寸                  | 148.17349677 mm | 151.17349677 mm |
| Y 尺寸                  |  42.90225889 mm |  42.90225889 mm |
| Z 尺寸                  |  50.59214939 mm |  50.59214939 mm |
| 体积                    |  10883.7083 mm³ |  11200.3532 mm³ |
| BOP 警告                |             186 |             204 |

连续三次执行得到相同实体数量、体积、包围盒、固定端和警告类型。原文件 SHA-256 保持为 `28eef649442705b570b2b5148a37663b99dc799fd1d5a65ce7cf2d1981680f67`。

加固后又完成六项真实 FreeCAD 组合：X 正向 0.1 mm、X 负向 10 mm、Y 正向 0.5 mm、Y 负向 3 mm、Z 正向 10 mm、Z 负向 0.1 mm。六项都通过单实体、闭合、尺寸、固定区域体积对称差和 BOP 基线门禁。该矩阵覆盖三轴、两个方向、距离上下限和中间值，不代表穷举连续距离区间或任意截面。

### BOP 判定

普通 `isValid` 不是完整门禁。固定脚本执行带 BOP 的完整检查。

源样本已有 186 条 `InvalidCurveOnSurface`，因此不能诚实地宣称“无警告通过”。本轮冻结的策略是：

- 源错误类型必须全部在显式白名单中；
- BOP 异常类型、固定标题和每条错误明细必须全部解析，未知格式一律失败；
- 输出不能新增错误类型；
- 输出警告数量最多比源模型增加 64 条；
- 其余实体、闭合、基础 B-Rep、体积和尺寸门禁仍必须全部通过；
- 返回 `passed-with-baseline-warning`，并要求专业 CAD 复核。

本次输出为 204 条相同类型警告，符合源基线策略。这是可控的工程门禁，不是可制造性证明。

## M1：实现结果

### Contract 与固定适配器

`CadModificationSnapshot` 冻结：输入、源哈希、唯一操作、轴、方向、距离、截面、固定端、输出和预期 X/Y/Z 尺寸。

Agent 只能提交数据参数。FreeCAD 运行 Studio 内置的固定 Python 适配器；主进程使用 `spawn` 参数调用，不拼接 shell 命令。距离限制为 `0.1–10 mm`。

### 服务

`CadModificationService`：

- 规划阶段验证输入、输出、后端、单实体和截面证据；
- 通过 FileService 把已授权源文件复制到应用私有快照，FreeCAD 不直接读取用户路径；
- 执行前重新比较源哈希并拒绝覆盖已有输出；执行结束、发布前再次校验源文件；
- 将请求和结果写入权限为 `0600` 的临时 JSON；
- FreeCAD 只在应用私有临时目录写 STEP；
- 重新导入后验证对象数、solid 数、闭合、valid、基础 B-Rep、体积、BOP、尺寸、固定端和固定区域体积对称差；
- FileService 独占创建目标，发布前后校验父目录和目标 inode，不覆盖已有文件；
- 规划、修改、超时和 destroy 都能终止 FreeCAD 子进程并清理临时文件；
- 不创建新的用户任务、确认状态、版本记录或 operation 生命周期。

阈值：目标与非目标尺寸误差 `≤ 0.05 mm`，固定端误差 `≤ 0.01 mm`；固定区域体积对称差 `≤ max(0.002 mm³, 固定区域体积 × 0.2 ppm)`。固定区域门限来自真实 Y/Z STEP 重导入与 OCCT 布尔交集的数值噪声，1 mm³ 的模拟固定区变化会被拒绝。

### Agent 工具与确认

只新增两个工具：

- `cad_plan_modification`：无副作用分析并返回完整 snapshot；
- `cad_modify_step`：强制确认后执行和核验。

继续复用 `cad_inspect_model`，没有新增分析或独立核验工具。

`cad_modify_step` 的策略固定为：

```text
requireConfirmation: true
allowAlways: false
riskLevel: write
```

工具入口还强制检查 `context.confirmationGranted === true`。确认摘要共有 11 行；共享 IPC 解析器上限调整为 16，以容纳完整参数同时保留边界。

确认状态仍由 `McpToolHost → AgentToolAuthorizationBroker → PermissionManager → Agent Panel` 唯一拥有。

### Runtime 生命周期

修改服务由现有 CAD capability 创建、注入和清理：

- `app-runtime.ts` 持有服务引用；
- `optional-main-services.ts` 创建和回滚；
- `automation-runtime.ts` 注入 `CadToolModule`，停止时先结束 ToolHost；
- `core-services.ts` 负责兜底销毁；
- `agent-capabilities.ts` 只在预览和修改服务都就绪时注册 CAD 工具。

没有第二套启动器或全局状态所有者。

### 结果卡与自动打开

工具成功结果使用 `kind: cad-modification-result`。结果卡显示输出路径、轴与距离、源/输出尺寸、实体数量、体积、完整性状态和可制造性警告。

自动打开只响应当前活跃本地会话和当前 `activeRunId` 的实时结果。renderer 再检查工作空间包含关系，按 `toolUseId` 去重，并复用现有 Tab Store。

真实验收发现原始 Claude MCP 工具名是 `mcp__cclink_studio__cad_modify_step`。首版只匹配裸名导致文件生成后未自动打开；修复为同时接受裸名和 `__cad_modify_step` 后缀后，第二次真实验收自动新增、选中并渲染了输出标签页。历史恢复、非活跃 Run、远程工作空间和越界路径仍不打开。

## 相关文件清单

### 新增

- `src/main/cad/cad-modification-types.ts`
- `src/main/cad/freecad-section-insert-script.ts`
- `src/main/cad/cad-modification-service.ts`
- `src/main/cad/cad-modification-service.test.ts`
- `src/renderer/src/features/cad/cad-modification-auto-open.ts`
- `src/renderer/src/features/cad/cad-modification-auto-open.test.ts`

### 修改

- `src/main/cad/cad-conversion-service.ts`
- `src/main/cad/cad-conversion-service.test.ts`
- `src/main/cad/cad-ipc.ts`
- `src/main/cad/cad-ipc.test.ts`
- `src/main/cad/freecad-detector.ts`
- `src/main/cad/freecad-detector.test.ts`
- `src/main/fs/file-service.ts`
- `src/main/fs/file-service.test.ts`
- `src/main/mcp/modules/cad/index.ts`
- `src/main/mcp/modules/cad/index.test.ts`
- `src/main/mcp/tool-confirmation-summary.ts`
- `src/main/mcp/tool-confirmation-summary.test.ts`
- `src/main/runtime/agent-capabilities.ts`
- `src/main/runtime/app-runtime.ts`
- `src/main/runtime/optional-main-services.ts`
- `src/main/runtime/automation-runtime.ts`
- `src/main/runtime/automation-runtime.test.ts`
- `src/main/runtime/core-services.ts`
- `src/shared/ipc/cad.ts`
- `src/shared/ipc/agent.ts`
- `src/shared/ipc/event-payload.test.ts`
- `src/preload/index.ts`
- `src/preload/index.d.ts`
- `src/preload/local-ops-api.ts`
- `src/renderer/src/components/workbench/ModelViewer.tsx`
- `src/renderer/src/components/workbench/WorkbenchContent.tsx`
- `src/renderer/src/components/common/ConversationMessageRenderer.tsx`
- `src/renderer/src/components/common/ConversationMessageRenderer.test.ts`
- `src/renderer/src/bootstrap/use-agent-stream-events.ts`
- `src/renderer/src/assets/main.css`

仓库中同时存在其他任务的未提交改动；本功能没有回退或重写这些改动。

## 验证结果

### 自动化

- `pnpm typecheck`：通过；
- CAD、FileService、MCP、确认摘要、事件解析、结果卡和自动打开的集中测试：通过；
- 固定区域变化、未知 BOP、换链越界发布和规划取消负向测试：通过；
- 真实 FreeCAD 六组合服务集成矩阵：通过；
- 最终 `pnpm verify`：通过；格式、lint、权限边界、发布边界和生产构建均通过；
- 全量 Vitest：405 个测试文件通过，3,285 个测试通过，9 个跳过；
- `git diff --check`：通过。

### 真人验收

- 确认卡可见且参数完整；
- 强制本次确认，没有“始终允许”；
- 输出 STEP 生成且原文件未覆盖；
- Agent 结果卡显示结构化证据和源基线警告；
- 文件树实时出现输出；
- 自动新增并选中输出模型标签；
- 新版预览显示 1 个对象、17,394 个渲染顶点、5,798 个三角形，X 向预览网格包围盒约 `151.17 mm`；
- 精确 B-Rep X 尺寸为 `151.17349677 mm`。

加固后又在真实 Electron 开发版完成 Y 正方向 `0.5 mm` 复验：规划结果可见，`cad_modify_step` 独立强制确认卡可见；允许后输出自动打开。结果卡显示 B-Rep 尺寸 `148.17 × 43.40 × 50.59 mm`、固定区域几何差 `1.304e-3 / 2.000e-3 mm³`、BOP “完整解析 / 194 条”，以及源模型 186 条基线警告和专业 CAD 复核提示。输出文件为 `光机左镜框精简20260716-Y正向加宽0.5mm-AI-加固验收.STEP`，SHA-256 为 `db31cc8161d567953c1d01e66a46b56bce7ebf8b212f1b5ea36b5cbec5460106`。

## 残余风险

1. 真实样本自身有 `InvalidCurveOnSurface` 基线警告。首版只做到相对源模型的受控门禁，专业 CAD 复核仍是送加工前必需步骤。
2. `section-insert` 对截面可切成两侧各一个 solid 的单实体模型有效，不承诺任意眼镜 STEP。
3. 预览网格包围盒和 B-Rep 包围盒可能不同；界面已经标明预览值，核验以结果卡的 B-Rep 数据为准。
4. 当前依赖用户机器已安装可调用的 FreeCADCmd；没有提供受管安装或随 App 打包。

## 后续候选，不进入本轮

- 选面和 face 映射；
- 第二种修改操作；
- PCB、电池、光学件装配和干涉；
- 原版/新版对比；
- 版本数据库和实物反馈；
- 受管 FreeCAD 分发或第二生产后端；
- 强度、公差和制造分析。

只有用户确认当前单操作在真实迭代中有价值后，才为其中一项单独立项。
