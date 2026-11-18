# pi-missions：让下一段执行接得上

2026-11-18 · Owner 0.1 独立调研。依据官方说明和源码，未运行上游产品。决定：借鉴交接、核对与恢复规则，不引入 pi 扩展或 worker 代码。仓库已归档。

## 用户怎么用

主控先澄清目标，组织里程碑、工作项和验收条件；计划批准后逐项派工。每次 worker 只拿到本步问题和所需背景。结果返回后可安排独立验证，里程碑还可以执行工程检查；验证失败可以生成修复项。事务计划与执行结果保存在会话外，可在中断后核对恢复。它针对编程，不应把测试通过直接翻译成任意事务达成。

## 页面 UI：终端里的 Mission Control

[官方操作说明](https://github.com/0xkuze/pi-missions#mission-control-actions)与[上游 UI 源码目录](https://github.com/0xkuze/pi-missions/tree/main/extensions/ui)。它是终端浮层，不是桌面聊天窗口。下图是按官方入口整理的交互说明图，不是作者的产品截图：

```text
任务入口 → 审阅计划 → Mission Control：当前任务的进度与工作项
                          ├─ V 验证结果：本次核对通过了什么？
                          ├─ L 进展日志：刚才发生了什么？
                          ├─ H 计划历史：为什么改了下一步？
                          └─ P 暂停/恢复，R 补充指示
```

**可借鉴：** 把核对结果与执行输出分开；恢复时先展示已知事实。**需要改变：** Studio 用户打开事务就应看见当前动作、阻塞、下一步，不能要求先知道某个快捷键或打开日志。

## 实现与引入判断

[派工源码](https://github.com/0xkuze/pi-missions/blob/main/extensions/tools/spawn-worker.ts)构造本步上下文和 prompt，以 `--no-session` 启动独立 pi 进程，保存输出、结构化结果与尝试记录。[恢复说明](https://github.com/0xkuze/pi-missions#crash-recovery)描述重启后对账：找到结果就处理，没有结果就标为中断。进程退出与业务目标达成不是同一个事实。[项目与许可证](https://github.com/0xkuze/pi-missions)。

**取其交接问题：做什么、已知什么、缺什么、交回什么。** 不移植它的进程、文件状态机、Git 自动提交和自动重试；Studio 的执行单元是可打开、可续用的原生会话。尤其在有外部副作用时，缺回执应先核对，不能盲目重做。
