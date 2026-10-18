# 网站账号与网页事务启动失败诊断

> 2026-10-16：实现与真实 Electron 自动验收已通过；真人签收尚未执行。

## 用户验收动作

在隔离测试 Profile 中制造网站账号或事务状态加载失败，启动 Studio，进入“网站与账号”或
“事务”。用户应能看到失败阶段、原因和恢复指引，展开或复制诊断；此时仍能读取本地文件、
打开普通浏览器并加载网页。修复测试文件后重启 Studio，应恢复正常且不再显示旧失败。

这项改动仅改善初始化失败的可诊断性，不代表文章发布闭环、WebAffair 拆分或 Runtime
组件循环依赖已完成。

## 边界与恢复

- 主进程启动装配层记录两个服务的启动失败元数据。`WebResourceService`、
  `WebAffairService` 仍各自拥有领域事实；renderer 只呈现失败投影。
- 复用原有 `SERVICE_UNAVAILABLE` 返回，新增可选 `startupFailure`；没有新增 IPC 通道、
  服务生命周期或前端成功推断。
- 诊断字段限于 service、state、stage、code、recovery 和 occurredAt，并经过共享 schema
  校验。不发送原始异常、堆栈、文件内容、账号信息或用户绝对路径。
- 区分权限拒绝、空间/配额不足、存储不可访问、状态格式/引用无效、文件过大和未分类异常。
  原因按类型和 OS 错误码归类，不解析日志文案。
- 保持现有有效备份自动恢复行为；无法恢复时保留失败，不通过删除文件或空历史掩盖错误。
- 不提供原地重新初始化按钮。修复原因后必须重启，由现有 ServiceRegistry 重建依赖；仅重新
  调用 `load()` 无法证明 Agent 工具、发布服务和其他引用已同步重建。
- 本地网站账号与事务启动不依赖 CCLink 登录或服务配置；不将远程缺配置解释为本地失败原因。

## 工程验证

先执行 `pnpm build`，再运行：

```bash
node scripts/web-service-startup-smoke.mjs
```

脚本启动完整 Electron App，使用独立 Profile 和本地 HTTP 页面，不读取真实账号、不调用模型，
不覆盖系统剪贴板；结束时关闭测试实例并移除测试数据。截图与结果保存到脚本输出的
`cclink-web-startup-evidence-*` 临时目录。

自动验收覆盖：

1. 两个域的主文件与备份均损坏：可见错误、可复制允许字段，剪贴板失败时可展开手动复制。
2. 失败状态下本地文件可读，普通 Browser 能加载真实本地 HTTP 页面。
3. 损坏原文件和备份在退出后仍保留。
4. 修复测试文件并重新启动：两个域均恢复，旧失败提示消失。
5. 真实文件权限拒绝与损坏的执行恢复日志显示不同原因或阶段。
6. 主文件损坏但备份有效时仍可自动恢复。

相关单元和 IPC 回归命令：

```bash
pnpm exec vitest run --silent=true \
  src/shared/web-service-startup.test.ts \
  src/main/diagnostics/web-service-startup-error.test.ts \
  src/main/web-resources/web-resource-ipc.test.ts \
  src/main/web-affairs/web-affair-ipc.test.ts \
  src/main/web-resources/web-resource-service.test.ts \
  src/main/web-affairs/web-affair-service.test.ts \
  src/main/web-affairs/article-publishing-state.test.ts
```

## 拷问与剩余边界

未知异常只能报告“未分类异常”，不得臆测为数据损坏。磁盘写满与配额不足由错误码回归覆盖，
不通过占满用户真实磁盘验收。账号草稿存储原有的降级读取行为未在本轮改写。
真人可读性、辅助技术体验及用户实际故障资料的维护者恢复流程仍需真人签收；自动化通过只证明
上述工程门禁，不代表已完成这些签收。
