# 在新 Mac 上恢复 CCLink Studio 的 Codex 对话

这是 2026-11-19 的一次性迁移快照。`sessions/` 中每个 `.age` 对应一条未归档会话，包含原生会话记录，不是摘要。本次迁移会话只到导出时刻。标题和内容均已加密。解密钥匙不在 Git 中；旧 Mac 抹盘前，务必把钥匙单独传到新 Mac，并完成下列验收。

1. 用 AirDrop 或 U 盘传输旧 Mac 的 `~/Downloads/CCLink-Migration-20261119/cclink-studio.agekey`。不要把它放入项目或发到公开渠道。
2. 在新 Mac 安装并用原账号登录 Codex，然后退出桌面应用。准备好 `python3` 和 `brew install age zstd`，克隆仓库，在仓库根目录运行（参数改成钥匙的实际位置）：

   ```sh
   python3 codex-migration/restore.py ~/Downloads/cclink-studio.agekey
   ```

3. 脚本逐条校验原始记录的 SHA-256，把会话放入本机 Codex 数据目录，再调用本机 Codex 按原 ID 恢复并读回历史轮次；不会发送模型消息。已经存在的同 ID 会话不会被覆盖。脚本另存可阅读的文字稿到 `~/CCLink-Restored-Chats/`，不要把这个明文目录提交到 Git。
4. 打开 Codex，把**新克隆的仓库目录**加为项目。选择熟悉的会话，核对最后一次问答并发送一条追问。也可以在仓库根目录运行 `codex resume <会话ID>`；ID 就是对应密文文件的文件名去掉 `.age`。若原生索引中途失败，文字稿仍在，可按对应 ID 单独续接。

备份范围是会话记录本身，不包含登录凭证、工作区外的文件、单独存放的图片附件、浏览器状态或旧机器的工具配置。历史消息中出现的旧路径保留原文；新的工作目录使用本次克隆位置。
