# Agent 预制角色（历史兼容说明）

> 状态：本文件原方案已被 `docs/features/agent-role-configuration.md` 取代。
>
> 最后更新：2026-07-31。

`v0.1.14` 首次加入七个内置角色与 Composer 选择器，但把有历史会话的角色切换实现为
新建会话，并且缺少“同一会话连续发送时主进程实际采用哪份配置”的运行回执。异机验收
发现第二次发送的角色行为不稳定，因此旧版完成结论已经撤回。

当前产品模型已经改为：

- 角色是 `AgentConversationConfiguration` 的一部分，不是新会话模板；
- 切换角色保留同一会话 ID、可见历史、草稿和挂载资源；
- 切换后只重建目标会话的内部 Runtime Session；
- 每次发送都携带配置，并校验主进程返回的配置回执；
- Activity、Sidebar、配置 Tab 与 Composer 共享同一个会话配置入口；
- 第一阶段只有七个只读内置角色和一个全局“新会话默认角色”。

当前事实、UI、状态所有权、IPC 契约、失败降级、实施状态和验收步骤统一见
`docs/features/agent-role-configuration.md`。旧的 `AgentProfileRef/profileRef` 只保留一版读取
兼容；新快照只写 `configuration.roleRef`，不得把两者发展为两个状态所有者。
