# 可分离 Workbench Tab P0 验收证据

- 日期：2026-08-19
- 基线提交：`72bca5b9`
- 运行平台：macOS / Darwin arm64
- Electron：43.1.1
- 结论：P0a、P0b 通过；允许编写和评审 ADR，不代表 Browser M1 或用户功能已交付

## 用户功能进度

用户仍不能把 Workbench Tab 移到独立窗口。本轮只证明 Electron 43 的 Browser runtime 路线和
Recovery Host 候选可行，未向生产应用接入窗口、命令、菜单或拖拽入口。

## 可复现入口

```bash
pnpm smoke:detachable-tabs-p0a
pnpm smoke:detachable-tabs-p0b
pnpm smoke:detachable-tabs-p0
```

统一入口会在临时 `userData` 和本地受控 HTTP 页面中依次启动两个隔离 Electron 进程。任一阶段
失败时命令返回非零，并输出失败阶段和断言；不会加载第二套 Studio App 或写入用户工作空间。

## P0a：核心身份与回滚

统一重跑结果：通过。

- 同一个 `WebContentsView` 完成 A → B → A。
- 注入 target attach 失败后，同一个 View 回到 A。
- `webContents.id`、Session 对象、持久 partition storage path、稳定 `tabId`、CDP target ID 和
  Playwright `Page` 对象均不变。
- 导航计数始终为一次 start / 一次 finish；没有 reload、re-navigation 或 renderer 重建。
- 页面 boot ID、`performance.timeOrigin`、内存变量、输入值、Cookie 和滚动位置保持不变。

最后一次统一运行的身份摘要：

| 字段           | 结果                                         |
| -------------- | -------------------------------------------- |
| WebContents ID | `3`，全程不变                                |
| CDP target ID  | `080DA562139963DABA4F85A05A68FCE8`，全程不变 |
| 导航计数       | `started=1`、`finished=1`                    |
| 失败回滚       | target attach 注入失败后返回 A               |

## P0b：最小交互、Recovery Host 与释放

统一重跑结果：通过。

- popup 的 `window.opener` 在 source、target 和 Recovery Host 往返后仍指向同一父页面。
- source、target、restored 三个用户可见宿主均通过页面点击取得文档与输入框焦点。仅调用
  `webContents.focus()` 不足以证明页面焦点，因此 smoke 不把该 API 调用当作验收结果。macOS 在
  Codex 保持前台时可能拒绝把测试 Electron 进程标成 native focused；native host focus 不再作为
  P0 自动门禁，改由 M1 物理双屏真人验收确认，P0 输出仍保留 native focus snapshot 供诊断。
- 单个 owner listener 按 `source:1 → target:2 → recovery:3 → restored:4` 路由四个事件，迁移中
  未重复注册，结束时回到初始 listener 数量。
- 销毁 source 和 target 后，向已销毁 target attach 的注入失败被捕获；同一个 View 进入隐藏、
  无 renderer、无 preload 的 `BaseWindow` Recovery Host，随后恢复到新的合法窗口。
- Recovery Host 前后 `document.visibilityState` 都是 `visible`；WebContents、CDP target、Playwright
  Page 和页面 boot ID 不变。
- 结束时 popup、child View、WebContents 和 Playwright Page 均显式释放，Recovery Host child
  列表为空，原 owner listener 已移除。

最后一次统一运行的身份摘要：

| 字段                | 结果                                            |
| ------------------- | ----------------------------------------------- |
| WebContents ID      | `4`，全程不变                                   |
| CDP target ID       | `E0E018E001F05A3582F87DD4D84CA2C0`，全程不变    |
| Recovery visibility | `visible → visible`                             |
| owner generation    | `source:1 → target:2 → recovery:3 → restored:4` |

## P0 退出判断

- P0a：Go。
- P0b：Go。
- 隐藏 `BaseWindow` Recovery Host：在当前平台和锁定 Electron 版本上可作为 ADR 主线。
- ADR：Go。
- ADR 完成前启动 Browser M1：No-Go。

## 未覆盖项与后续门禁

P0 使用本地受控页面和最小 native host，刻意未验证生产 `BrowserManager`、真实登录网站、认证
子进程、下载、BrowserTask、完整 renderer 事件、workspace reconcile 或 renderer crash。这些不是
P0 失败，但必须在 Browser M1 的自动化和真实 App 验收中补齐。

当前正式发布目标是 macOS arm64，因此本证据足以进入 ADR 和本机 M1 开发。若 M1 增加 Windows
或 Linux 发布目标，对应平台必须先通过同一核心 smoke；未验证平台不得进入支持声明。

本证据不替代 `pnpm verify`，也不构成用户功能完成声明。Browser M1 必须在 ADR accepted、生产
代码完成、受影响 smoke/`pnpm verify` 通过并完成真实 App 端到端验收后，才能报告交付。
