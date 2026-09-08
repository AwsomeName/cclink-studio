# 一次性网站账号迁移

用户验收动作：旧 Mac 完全退出 Studio 后导出；把整个迁移文件夹和脚本传到新 Mac；新 Mac 退出 Studio 后导入；启动后在“网站与账号”逐个打开平台，核验真实身份、登录状态，再重启复查。尚未执行真实双机验收。

脚本：`scripts/migrate-web-accounts.py`，仅依赖 Python 3 标准库和系统 `lsof`。当前默认路径和验证环境为 macOS；建议两端使用相同 Studio 版本。脚本仅支持 v3 账号目录。

将脚本复制到两边桌面。旧电脑：

```sh
python3 ~/Desktop/migrate-web-accounts.py export ~/Desktop/studio-accounts-transfer
```

把整个 `studio-accounts-transfer` 文件夹传到新电脑桌面。新电脑：

```sh
python3 ~/Desktop/migrate-web-accounts.py import ~/Desktop/studio-accounts-transfer
```

可用 `--data-dir "/实际/Studio数据目录"` 指定其他路径。默认 `~/Library/Application Support/CCLink Studio`。不要选择旧 Commercial 数据目录或复制整个 userData。

范围：账号目录及其引用的持久化浏览器 partition（含站点存储，排除主要缓存和锁文件）。不包含 CCLink Session、通用凭证、项目、事务、定时任务或默认浏览器环境。不会读取系统钥匙串。登录凭证如果受设备加密、过期或平台风控约束，原始文件迁移无法保证恢复，需重新登录；脚本清除导入账号的旧登录确认时间。

导出文件夹未加密，权限收紧仅保护当前本机。请通过 AirDrop 或自有加密磁盘传输；不要上传 Git、聊天或公开网盘，验收后删除传输副本。

导入保留已有不同 ID 的资料；同 ID 不同内容、同 Profile 或已有目录均停止。不会按账号名猜测合并。先暂存所有数据，再更新目录；普通复制失败不影响原目录。原账号 JSON 和已有 `.bak` 保存在工具输出的 `account-migration-backup-*` 目录。不能在迁移期间启动 Studio；进程检查不能替代用户保持应用关闭。意外断电可能留下未被引用的 Profile，此时脚本拒绝重试覆盖，需要核对备份后人工恢复。

恢复：完全退出 Studio 后，以备份的 `web-resources.json` 恢复账号目录；仅清理确认由本次迁移新增的 partition，不要删除已有账号环境。原目标没有账号文件时备份目录可为空，不能凭空恢复成旧资料。

工程验证：`python3 scripts/migrate-web-accounts-test.py` 使用临时目录检查数据往返、缓存和额外凭证排除、旧登录确认清除、冲突不覆盖、符号链接拒绝和活动文件阻断。它不是平台真实登录验收。
