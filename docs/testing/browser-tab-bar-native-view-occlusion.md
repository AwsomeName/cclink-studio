# 内嵌浏览器覆盖 Tab 栏与远程项目状态误判事故

> 状态：已在 `v0.1.55` 关闭；禁止回归。  
> 事故时间：2026-08-21。  
> 修复提交：`50777e0b`；契约测试补充：`862f6de0`；发布提交：`d159410e`。

## 用户影响

用户在本地工作空间 `~/Desktop/woniu-forward` 中打开内嵌浏览器后，工作台表现为“整体卡死”：
网页仍然可见，但 Tab 无法切换。同期诊断中存在大量腾讯 IM 网络错误和 WebSocket 关闭异常，
因此现场还产生了“本地项目为什么连接 CCLink、它到底是本地还是远程项目”的疑问。

最终必须把两个问题分开判断：

1. Tab 无法点击属于 Electron 原生 `WebContentsView` 与 React 工作台的边界问题。
2. “当前激活本地工作空间”不等于“项目条中没有打开的远程工作空间”。CCLink transport 是
   应用级远程连接，可以在当前显示本地项目时继续服务后台仍处于打开状态的远程项目。

## 现场证据与证据缺口

原始框架诊断可以确认：

- 当前激活工作空间是本地路径；“当前远程能力探测”报告当前不是远程工作区。
- 请求、可视和当前 Tab 都是同一个 Browser Tab；renderer 仍能生成完整诊断。
- 主进程日志持续出现腾讯 IM 网络错误和 `WebSocket was closed before the connection was established`。
- 报告只记录当前激活工作空间，没有记录项目条里已打开的远程工作空间数量。
- `v0.1.54` 没有记录 renderer bounds、原生 View bounds、保护线和是否越界。

因此，旧日志不能还原事故时 `WebContentsView.y` 的精确数值，也不能仅凭“当前是本地”证明
CCLink 连接没有合法的远程项目使用者。修复关闭的是已确认的原生覆盖失败类别和诊断盲区，
不得把缺失的旧边界数据包装成已经取到的证据。

## 原因一：原生网页层可以吞掉 React 点击

内嵌网页不是 `.workbench-content` 中的 DOM 子节点，而是主进程挂到窗口上的原生
`WebContentsView`。它位于 React renderer 之上：一旦主进程收到过期、换算错误或越过工作台
顶部的 bounds，网页不只会视觉覆盖 Tab 栏，还会优先接收该区域的鼠标事件。此时 React 没有
崩溃，改 CSS `z-index` 或给 Tab 增加点击处理也不能解决问题。

`v0.1.55` 建立以下不变式：

- renderer 同时测量 Tab 栏和浏览器内容区，保护线取两者下边界中的更低安全位置；Tab 栏和
  浏览器工具栏上方全部属于原生 View 禁区。
- `workbench:bounds` IPC 必须携带有限、非负且有上限的 `protectedTop`；缺字段、无限值或
  非受信 renderer 的消息全部丢弃。
- 主进程按主窗口 zoom 把 CSS 坐标换算为 DIP，再独立执行一次裁剪。最终必须满足
  `nativeBounds.y >= nativeProtectedTop`。
- `BrowserManager` 继续是原生 View bounds 的唯一 owner；renderer 只能报告布局事实，不能
  直接拥有或修正原生 View。
- 原生 View 的显示采用双门禁：非当前目标先 `setVisible(false)`，再从 host 层级移除；只有
  当前 host 的明确 active target 才能在完成 attach 与 bounds 后 `setVisible(true)`。浮层、
  编辑器或其他 Tab 不得只依赖 `removeChildView` 推断网页已经停止绘制。
- 框架诊断必须并列输出 renderer bounds、native bounds、`protectedTop`、
  `nativeProtectedTop`、`overlapsProtectedTop`，以及原生 View 的实际 attached/visible 状态。

禁止使用以下方式“修复”：

- 只提高 Tab 栏 `z-index`；DOM 层级不能压过原生 `WebContentsView`。
- 只依赖 `ResizeObserver` 上报的内容矩形而不给主进程保护线。
- 在 preload 或辅助窗口建立第二个 bounds owner。
- 通过 reload、隐藏 Tab 或延时重测掩盖越界。

## 原因二：诊断把“当前项目”误读成“全部打开项目”

Studio 的项目条可以同时保存多个本地和远程工作空间。以下状态完全合法：

```text
当前激活：local:/Users/.../woniu-forward
打开的远程工作空间：2
CCLink realtime：online
```

这表示用户当前查看本地项目，而应用级 CCLink 连接服务另外两个仍打开的远程项目；本地项目
没有因此变成远程项目。`activeWorkspaceRef` 与 `openRemoteWorkspaceRefs` 是两个不同事实：

| 事实               | 所有者                                         | 含义                                     |
| ------------------ | ---------------------------------------------- | ---------------------------------------- |
| 当前激活工作空间   | `useWorkspaceStore.activeWorkspaceRef`         | 当前 Workbench、文件树和 Tab 投影        |
| 已打开远程工作空间 | `useOpenProjectsStore.openRemoteWorkspaceRefs` | 项目条中仍保持打开的远程项目             |
| 实时 transport     | 主进程 `CclinkRemoteService`                   | 为所有远程项目共享的腾讯 IM/request 通道 |
| renderer 连接投影  | `useCclinkStore.realtime`                      | UI 和诊断使用的只读连接状态              |

启动自动连接策略必须是：

| 当前状态                                       | 是否自动恢复 CCLink realtime |
| ---------------------------------------------- | ---------------------------- |
| 当前为本地/全局，且没有打开远程项目            | 否                           |
| 当前为本地，但项目条仍有打开远程项目           | 是，服务后台远程项目         |
| 当前为远程工作空间                             | 是                           |
| 只有历史登录 Session，没有当前或打开的远程项目 | 否                           |
| 用户明确点击 CCLink 远程入口或登录并连接       | 是                           |

恢复登录 Session 本身不得直接连接腾讯 IM。工作空间启动先让本地工作台就绪，再由远程连接
策略根据当前工作空间与项目条事实异步恢复；远程连接失败不得阻断本地工作台。

框架诊断现在必须报告：

- 当前激活工作空间种类；
- 已打开本地/远程项目数量；
- CCLink realtime 状态；
- 当前本地但后台有远程项目时，明确说明连接用途不会改变当前项目类型。

## 回归验收

### 浏览器边界

1. 在真实 Electron 主窗口打开 Browser Tab。
2. 连续点击 Browser、Editor、Terminal Tab，均能切换；网页不得截获 Tab 栏点击。
3. 打开更新弹窗再关闭，Browser View 正确隐藏和恢复，仍不越过保护线。
4. 调整侧栏、窗口和应用缩放；诊断始终满足
   `overlapsProtectedTop=false`、`nativeBounds.y >= nativeProtectedTop`。
5. 执行浏览器 Tab 拆分、返回主窗口和应用重启；同一个 View 恢复后仍满足上述约束。

### 本地与远程连接

1. 只打开本地项目，保留历史 CCLink Session 后重启；本地工作台先就绪，不因 Session 自动连接。
2. 当前激活本地项目、项目条保留至少一个远程项目后重启；CCLink 自动恢复，诊断同时显示
   “当前本地”和正确的打开远程项目数量。
3. 点击远程项目；连接成功后再确认远程文件、Agent 和 PTY 使用对应 `RemoteWorkspaceRef`。
4. 远程网络不可用时，本地项目、Agent、Browser、Editor 和 Terminal 仍可操作。

自动门禁：

```bash
pnpm verify
pnpm smoke:ui
pnpm smoke:detachable-tabs-m1
```

`v0.1.55` 的证据：本地 `pnpm verify` 为 307 个测试文件、1823 项通过、2 项按设计跳过；
精确源码 CI run `32460687721` 成功；正式签名、公证和 Release workflow run `32460937506`
成功，并公开四项 arm64 资产。

## 残余风险

- `v0.1.55` 增加了边界诊断，但无法补回 `v0.1.54` 事故发生时未采集的原生坐标。
- 当确实有远程项目打开且网络异常时，腾讯 SDK 仍可能产生连接警告；这类错误必须降级且不能
  影响本地交互。不能为了让日志安静而错误断开仍在使用的远程项目。
- 此次发布没有宣称修复腾讯 SDK 的所有重连或内部 WebSocket 异常；后续若仍出现未捕获异常，
  必须单独记录 transport 生命周期证据，不能再次用“当前是本地项目”直接判定连接不合法。
