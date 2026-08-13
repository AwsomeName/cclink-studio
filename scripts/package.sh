#!/usr/bin/env bash
# package.sh — CCLink Studio 本地打包脚本
#
# 用法:
#   pnpm package:local               # Apple Silicon arm64 本地验收包
#   pnpm package:local -- --no-clean # 跳过清理 out/ dist/
#   pnpm package:local -- --no-install
#   pnpm package:local:dev           # 不压缩，打包更快但体积更大
#   pnpm package:local -- --open     # 打包后打开产物所在文件夹
#   pnpm package:local -- --help
#
# 说明: out/ 与 dist/ 均在 .gitignore 中，清理是安全的（可重新生成）。
#       本脚本只生成本地未签名测试产物，不修改版本、不提交也不上传。
#       开源正式发布请使用 pnpm release。

set -e

# ── 颜色 & helper ────────────────────────────────────────
CYAN='\033[36m'; GREEN='\033[32m'; RED='\033[31m'; YELLOW='\033[33m'; BOLD='\033[1m'; RESET='\033[0m'
info() { echo -e "${CYAN}[CCLink Studio]${RESET} $1"; }
ok()   { echo -e "${GREEN}[CCLink Studio ✓]${RESET} $1"; }
warn() { echo -e "${YELLOW}[CCLink Studio !]${RESET} $1"; }
die()  { echo -e "${RED}[CCLink Studio ✗]${RESET} $1"; exit 1; }

# ── 参数解析 ──────────────────────────────────────────────
ARCH="arm64"
CLEAN=1
INSTALL=1
COMPRESSION=""
OPEN_FINDER=0

usage() {
  cat <<'EOF'
CCLink Studio 本地验收包

用法:
  pnpm package:local               # Apple Silicon arm64 本地验收包
  pnpm package:local -- --no-clean # 跳过清理 out/ dist/
  pnpm package:local -- --no-install
  pnpm package:local:dev           # 不压缩，打包更快但体积更大
  pnpm package:local -- --open     # 打包后打开产物所在文件夹
  pnpm package:local -- --help

本命令不修改版本、不提交也不上传。开源正式发布请使用 pnpm release。
EOF
  exit 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    --)          shift ;;
    --no-clean) CLEAN=0; shift ;;
    --no-install) INSTALL=0; shift ;;
    --dev)      COMPRESSION="store"; shift ;;
    --open)     OPEN_FINDER=1; shift ;;
    -h|--help)  usage ;;
    *)          die "未知参数: $1（用 --help 查看用法）" ;;
  esac
done

# ── 预检：必须在项目根目录 ────────────────────────────────
[ -f package.json ] && [ -f electron-builder.yml ] \
  || die "请在项目根目录运行（需要 package.json + electron-builder.yml）"

# ── 架构校验 ──────────────────────────────────────────────
[ "$(uname -m)" = "arm64" ] || die "CCLink Studio 开源版本地打包只支持 Apple Silicon arm64"

info "目标架构: ${BOLD}$ARCH${RESET}"

# ── 1. 依赖安装 ───────────────────────────────────────────
if [ "$INSTALL" -eq 1 ]; then
  info "安装依赖（pnpm install）..."
  pnpm install
  ok "依赖就绪"
fi

# ── 2. 读取版本号（本地打包不得修改源码版本） ─────────────
VERSION=$(node -p "require('./package.json').version")
info "当前版本: ${BOLD}$VERSION${RESET}"
BUILD_PROVENANCE_PATH="/tmp/cclink-studio-build-provenance-$$.json"
trap 'rm -f "$BUILD_PROVENANCE_PATH"' EXIT
node scripts/source-fingerprint.mjs write "$BUILD_PROVENANCE_PATH"

# ── 3. 清理旧产物 ─────────────────────────────────────────
if [ "$CLEAN" -eq 1 ]; then
  info "清理旧的 out/ 与 dist/ ..."
  rm -rf out dist
  ok "已清理"
else
  warn "跳过清理（--no-clean），旧产物将被覆盖"
fi

# ── 4. 构建（electron-vite build） ────────────────────────
info "构建（pnpm build → electron-vite build）..."
pnpm build > /tmp/cclink-studio-build.log 2>&1 || { tail -30 /tmp/cclink-studio-build.log; die "构建失败，详见 /tmp/cclink-studio-build.log"; }
node scripts/source-fingerprint.mjs verify-file "$BUILD_PROVENANCE_PATH" out/build-provenance.json \
  || die "构建期间源码发生变化，请在工作区稳定后重新打包"
ok "构建完成"

# ── 5. 打包（electron-builder） ───────────────────────────
EB_ARGS=(--mac --arm64)
[ -n "$COMPRESSION" ] && EB_ARGS+=("--config.compression=$COMPRESSION")

info "打包 DMG（electron-builder ${EB_ARGS[*]}）..."
: > /tmp/cclink-studio-package.log
npx electron-builder "${EB_ARGS[@]}" "--config.mac.target=dmg" \
  >> /tmp/cclink-studio-package.log 2>&1 \
  || { tail -40 /tmp/cclink-studio-package.log; die "DMG 打包失败，详见 /tmp/cclink-studio-package.log"; }
ok "打包完成"

# ── 6. 验证瘦安装包边界 ───────────────────────────────────
APP_SEARCH_ROOT="dist/mac-arm64"
APP_PATH=$(find "$APP_SEARCH_ROOT" -maxdepth 2 -type d -name '*.app' -print -quit)
[ -n "$APP_PATH" ] || die "未找到打包后的 .app"
APP_EXECUTABLE=$(find "$APP_PATH/Contents/MacOS" -maxdepth 1 -type f -perm -100 -print -quit)
[ -n "$APP_EXECUTABLE" ] || die "未找到打包后的主程序"
PACKAGED_NAME=$(ELECTRON_RUN_AS_NODE=1 "$APP_EXECUTABLE" -e \
  "const fs=require('fs');const pkg=JSON.parse(fs.readFileSync(process.resourcesPath+'/app.asar/package.json','utf8'));process.stdout.write(pkg.name)" \
  2>/dev/null) \
  || die "打包后的 app.asar/package.json 无法解析；打包期间可能有文件被并发改写"
[ "$PACKAGED_NAME" = "cclink-studio" ] || die "打包后的应用元数据不正确"
PACKAGED_PROVENANCE=$(ELECTRON_RUN_AS_NODE=1 "$APP_EXECUTABLE" -e \
  "const fs=require('fs');process.stdout.write(fs.readFileSync(process.resourcesPath+'/app.asar/out/build-provenance.json','utf8'))" \
  2>/dev/null) \
  || die "打包后的源码指纹无法读取"
node scripts/source-fingerprint.mjs verify-json "$PACKAGED_PROVENANCE" \
  || die "打包产物不是由当前源码生成，请清理后重新打包"
[ ! -e "$APP_PATH/Contents/Resources/agent-runtime" ] \
  || die "瘦安装包不得携带 Claude Code Runtime"
ok "瘦安装包边界与源码指纹通过（Claude Code Runtime 按需安装）"

# ── 7. 结果摘要 ───────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}✅ 打包成功${RESET} — 版本 $VERSION / 架构 $ARCH"
echo ""
info "产物清单:"
for artifact in dist/*.dmg; do
  [ -e "$artifact" ] || continue
  size=$(du -h "$artifact" | cut -f1)
  printf "    %s  %s\n" "$size" "$artifact"
done
echo ""
echo -e "${CYAN}搬到另一台 Mac 的提示:${RESET}"
echo -e "  • 本地包仅做 ad-hoc 签封、未公证 → 若 macOS 拦截，安装后执行:  ${BOLD}xattr -cr /Applications/CCLink\\ Studio\\ 开源版.app${RESET}"
echo -e "  • 当前产物仅支持 ${BOLD}Apple Silicon arm64${RESET}"
echo -e "  • Claude Code Runtime 在组件管理页按需安装；模型服务和 API 凭证仍由用户配置"
echo -e "  • 内嵌浏览器用 Electron 自带 Chromium，无需额外下载"

if [ "$OPEN_FINDER" -eq 1 ]; then
  open dist/
fi
