# Architecture Decision Records

当实现需要改变或例外处理 `docs/architecture.md` 中的架构宪法时，先在本目录新增 ADR，再开始实现。

文件名使用 `NNNN-short-title.md`。状态使用 `proposed`、`accepted`、`superseded` 或 `rejected`。

```markdown
# ADR NNNN：标题

- 状态：proposed
- 日期：YYYY-MM-DD
- 负责人：

## 问题

## 决策

## 不变量

## 备选方案

## 风险与影响

## 迁移计划

## 回收或复审条件

## 验证
```

ADR 只记录会长期影响安全边界、模块依赖、生命周期、状态所有权、持久化或产品边界的决策。普通实现细节留在代码和 PR 中。

## 当前记录

- `0001-preserve-stabilization-snapshot.md`：保留 `49da3b2` 作为不可改写的稳定化现场快照，后续提交继续执行单一目标约束。
- `0002-bundled-claude-code-runtime.md`：以固定版本内置 Claude Code 作为新安装默认 Agent 运行时，并定义本机/自定义来源、认证边界、打包、切换、恢复和发布门禁。
- `0003-independent-edition-release-pipelines.md`：开源版与商业版由各自仓库独立构建和发布，不建立跨仓库发布依赖。
