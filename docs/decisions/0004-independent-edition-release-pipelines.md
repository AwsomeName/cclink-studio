# ADR 0004：开源版与商业版独立发布

- 状态：accepted
- 日期：2026-07-26
- 负责人：CCLink Studio Maintainers

## 问题

早期 R0 设计把 `cclink-dev` 定义为开源版的唯一发布编排者。这样虽然隔离了凭证，
却让开源版发布无必要地依赖另一个私有仓库，也把开源版和商业版的版本、权限及失败
生命周期耦合在一起。

## 决策

`cclink-studio` 和 `cclink-dev` 各自拥有完整且独立的发布工作流：

- `cclink-studio` 只从本仓库不可变 Tag 构建、签名、公证并发布开源版。
- `cclink-dev` 保留自己的商业版发布流程，负责私有集成和商业版制品。
- 两个仓库不调用对方的 workflow，不读取对方工作树，不共享 Release 状态。
- 开源版使用本仓库 `studio-release` Environment Secrets 和同仓库
  `GITHUB_TOKEN` 创建 Draft Release。

## 不变量

1. 开源版发布输入只能是 `cclink-studio` 中已存在的 `vX.Y.Z` Tag。
2. Tag、`package.json` 版本和 GitHub Release 版本必须一致。
3. P12、P8、密码和令牌不得进入 Git、安装包、日志、renderer 或诊断报告。
4. 开源版 workflow 不得访问 `cclink-dev`、生产 API、商业配置或商业制品。
5. 商业版 workflow 不得把私有实现复制回开源仓库。
6. 两个版本可以使用同一 Developer ID 发布者，但凭证按仓库 Environment 分别授权。

## 备选方案

- **由 `cclink-dev` 统一发布两个版本**：拒绝。引入不必要的跨仓库依赖和权限。
- **不签名直接发布开源版**：拒绝。公开安装和自动更新无法形成稳定的 macOS 信任链。
- **共享可复用 workflow**：当前不采用。只有重复维护成本实际出现并能保持权限隔离时再评估。

## 风险与影响

- 两条工作流需要分别维护 Electron、签名和公证参数。
- 同一证书轮换时需要分别更新两个仓库的 Secrets。
- 开源 workflow 位于公开仓库，必须保持最小权限，只允许维护者从不可变 Tag 手动触发。

## 迁移计划

1. 在 `cclink-studio` 增加开源版预检、签名、公证和 Draft Release workflow。
2. 将 R0 文档中的“`cclink-dev` 唯一发布者”改为双项目独立发布。
3. 不删除、不迁移 `cclink-dev` 现有商业版发布实现。
4. 开源版首次发布先运行 plan，再创建 Draft，经人工检查后公开。

## 回收或复审条件

只有两个版本的发布实现出现持续且高风险的重复缺陷时，才复审共享工具；共享工具也不得
重新建立跨仓库运行时依赖或共享发布状态。

## 验证

- 开源 workflow 只 checkout `AwsomeName/cclink-studio`。
- 缺少签名或公证凭证时，release 预检在打包前失败。
- plan 模式不读取 Environment Secrets。
- Draft Release 使用同仓库 `GITHUB_TOKEN` 创建。
- 构建记录包含源码 SHA、发布 workflow SHA、Tag、版本和架构。
