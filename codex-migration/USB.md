# 新 Mac 换机：从 U 盘恢复会话

本次迁移分两处保存：**U 盘带钥匙，Git 仓库带恢复脚本和 31 份加密会话**。仅有仓库不能解密，仅有 U 盘不能离线恢复。快照日期为 2026-11-19。

1. 在新 Mac 安装 Codex，用原账号登录后退出桌面应用。确认已安装 Git、Python 3 和 Homebrew，再运行 `brew install age zstd`。
2. 插上 U 盘，在 Finder 中打开 `CCLink-Migration-20261119`。确认有 `cclink-studio.agekey`，不要把它复制进仓库。
3. 在准备存放项目的目录打开终端，执行：

   ```sh
   git clone https://github.com/AwsomeName/cclink-studio.git
   cd cclink-studio
   python3 codex-migration/restore.py "/Volumes/NO NAME/CCLink-Migration-20261119/cclink-studio.agekey"
   ```

   如果项目已克隆，改在项目根目录执行 `git pull --ff-only` 和最后一行。若卷名不是 `NO NAME`，把最后一行的钥匙路径换成实际位置；可以直接从 Finder 将钥匙拖入终端来填入路径。

4. 首次恢复到空环境时，终端应显示 31 条「Codex 已读回」。打开 Codex，把刚克隆的项目目录加为项目，选一条熟悉的对话，核对历史并发一条追问。已有同 ID 会话不会被覆盖。恢复范围和文字稿位置见同目录的 `README.md`。

确认新 Mac 能续聊后再清理旧机。U 盘持有人可以用钥匙解密公开仓库里的会话，请妥善保管，不要借出。
