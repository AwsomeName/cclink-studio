# Historical: 远程项目维护优先级

> 当前状态：历史/商业能力材料，不属于 CCLink Studio OSS 当前事实源。

旧创始人工作台路线曾把“远程项目维护”列为 P0：

- 添加远程工作空间。
- 浏览远程文件树。
- 打开远程文件。
- 运行远程命令。
- 查看远程日志。
- 让 Agent / Codex / 自定义后端在远程上下文里工作。
- 对远程命令、文件写入、部署操作做权限确认和审计。
- 远程错误能定位到账号、transport、远端 Agent、文件 provider、执行后端或权限层。

这条路线现在不属于 `cclink-studio` OSS 默认边界。它依赖：

- official desktop overlay
- CCLink account/device/message/runtime 网络
- entitlement / pairing / token
- CCLink Agent runtime
- remote file provider
- remote Terminal
- remote diagnostics

这些能力应在 `/Users/apple/Desktop/cclink-dev` 和 `/Users/apple/Desktop/chat-cc` 侧继续推进。

## 拷问

远程维护的价值仍然成立，但不能靠把商业和 runtime 代码塞回 OSS 壳实现。

如果未来恢复，应先定义 overlay 注入点和空实现，而不是从历史文档反向恢复已删除模块。
