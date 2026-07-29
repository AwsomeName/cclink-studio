# AI 工作浏览器 v0.1 测试手册

> 状态：🔧 v0.1 发布前测试清单
> 范围：任务运行时、动作日志、暂停/终止、下载产物、文件缺失和基础网页交互。
> 原则：先本地确定性测试，再真实网站冒烟；不要把真实网站当稳定回归基准。

## /grilling 结论

v0.1 不能只证明“Playwright 能点网页”。真正要证明的是：

- Agent 浏览任务会自动创建、收束和展示。
- 浏览器动作会留下可追踪、脱敏的动作日志。
- 暂停/终止会在主进程执行层生效。
- 下载产物有来源、归属、路径、保留策略和文件缺失状态。
- tab 关闭、selector 不存在、文件被外部删除等失败路径不会静默误导用户。

## 一、自动化回归

### 必跑命令

```bash
pnpm typecheck
pnpm test src/main/browser/browser-task-runtime.test.ts src/main/browser/browser-download-store.test.ts
```

当前覆盖：

| 测试文件                                          | 覆盖                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| `src/main/browser/browser-task-runtime.test.ts`   | 任务状态机、暂停/取消拦截、完成释放 active、动作日志、参数脱敏           |
| `src/main/browser/browser-download-store.test.ts` | Agent 临时下载、用户系统下载、保留到工作空间、持久化、打开定位、文件缺失 |

### /grilling 风险

- 这些测试不启动真实 Electron 窗口，因此不能证明 WebContentsView、CDP target claim、真实下载事件都正确。
- 它们只证明主进程服务的业务规则可靠，是第一道闸门，不是最终发布证明。

## 二、本地测试页

本地测试页：

```text
src/main/playwright/test-page.html
```

覆盖能力：

| 区域          | selector                                          | 验证点                                     |
| ------------- | ------------------------------------------------- | ------------------------------------------ |
| 点击          | `#click-btn`                                      | DOM 文案变化，动作日志 succeeded           |
| 表单          | `#input-name` / `#input-email` / `#input-message` | fill 动作记录且 value 脱敏                 |
| 下拉          | `#select-city`                                    | select 动作                                |
| 复选框        | `#chk-agree` / `#chk-newsletter`                  | check / uncheck                            |
| 上传          | `#file-upload`                                    | uploadFile 权限与动作日志                  |
| 拖拽          | `#drag-source` -> `#drag-target`                  | dragDrop                                   |
| 对话框        | Alert / Confirm 按钮                              | handleDialog / autoDialog                  |
| iframe        | `#test-iframe`                                    | listFrames / frameExecute                  |
| popup         | `#popup-link`                                     | waitForPopup / tab 注册                    |
| 下载          | `#download-json` / `#download-text`               | BrowserDownloadRecord、taskRunId、临时路径 |
| 延迟元素      | `#show-delayed` / `#delayed-btn`                  | waitForSelector                            |
| 失败 selector | `#never-appears`                                  | timeout / selector_missing 分类            |

## 三、手动冒烟流程

### 启动

```bash
pnpm dev
```

### 基础任务链路

1. 打开浏览器 tab。
2. 将 Agent scope 切到当前浏览器 tab。
3. 让 Agent 打开本地测试页。
4. 让 Agent 点击 `#click-btn` 并填写表单。
5. 检查 Agent 面板出现任务卡。
6. 检查任务卡展示最近动作日志。
7. 任务完成后状态应为“已完成”。

验收：

- 自动创建 `BrowserTaskRun`。
- 动作日志至少包含 navigate/click/fill。
- fill 参数不展示原始输入值。

### 暂停与终止

1. 发起一个包含多个浏览器动作的任务。
2. 在任务卡点击“暂停”。
3. 让 Agent 继续操作或等待后续工具调用。
4. 后续浏览器动作应被主进程拒绝。
5. 点击“继续”，再执行动作。
6. 点击“终止”，任务状态应变成“已终止”。

验收：

- 暂停不是 UI 假状态；主进程必须返回 `Browser task is paused`。
- 终止后排队工具不能继续操作页面。

### 下载产物

1. 在 browser scope 下让 Agent 点击 `#download-json`。
2. 任务卡应显示下载文件。
3. 点击“打开”。
4. 点击“定位”。
5. 点击“保留”，文件应进入当前工作空间 `.cclink-studio/downloads/{taskRunId}/`。
6. 再触发一次下载，点击“另存为”并选择路径。
7. 再触发一次下载，点击“丢弃”。

验收：

- Agent 下载默认保存在 `userData/agent-downloads/{taskRunId}/`。
- 不会静默写入工作空间。
- 保留动作才复制到工作空间。
- 丢弃后任务卡显示“已丢弃”。

### 文件缺失

1. 完成一次 Agent 下载。
2. 在系统文件夹中手动删除该文件。
3. 重新打开任务卡或刷新下载记录。

验收：

- 下载产物显示“已丢失”。
- 打开、定位、保留、另存为按钮不可用，或主进程拒绝。

### tab 生命周期

1. 发起浏览器任务。
2. 在任务运行中关闭对应浏览器 tab。

验收：

- 任务变为 `cancelled` 或 `tab_closed`。
- Agent 不会继续操作已关闭 tab。
- Agent scope 应降级或提示目标失效。

## 四、失败路径必测

| 失败路径               | 操作                            | 预期                            |
| ---------------------- | ------------------------------- | ------------------------------- |
| selector 不存在        | 等待 `#never-appears`           | `timeout` 或 `selector_missing` |
| 用户暂停后工具继续调用 | 暂停任务后继续执行 browser 工具 | 主进程拒绝                      |
| 用户终止后还有排队工具 | 终止任务后继续执行 browser 工具 | 主进程拒绝                      |
| 无工作空间保留下载     | 未选择工作空间时点击“保留”      | 明确错误，不移动文件            |
| 外部删除下载文件       | 删除 tempPath/savedPath         | 显示已丢失                      |
| 下载重复文件名         | 连续下载同名文件                | 自动生成唯一文件名              |

## 五、真实网站冒烟

真实网站只做冒烟，不作为稳定回归基准。

建议场景：

- 普通搜索页：打开、输入、点击结果。
- 文档/资料页：提取内容并下载附件。
- 登录后工作站点：只验证登录态和基础导航，不测试高风险提交。

不承诺：

- 高风控站点。
- 验证码绕过。
- 银行、支付、企业强认证门户。

## 发布前通过线

v0.1 发布前至少满足：

- `pnpm typecheck` 通过。
- 任务/下载定向测试通过。
- 本地测试页手动冒烟通过。
- 下载产物路径和保留策略符合文档。
- 暂停/终止在主进程执行层生效。
- 已知失败路径能被 UI 或日志解释，而不是静默失败。
