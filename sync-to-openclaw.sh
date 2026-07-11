#!/bin/bash
# sync-to-openclaw.sh — 将最新代码同步到 OpenClaw 扩展目录并重新编译
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_DIR="$HOME/.openclaw/extensions/openclaw-mutsumi-world"

if [ ! -d "$EXT_DIR" ]; then
  echo "❌ 扩展目录不存在: $EXT_DIR"
  echo "   请先 git clone 或创建联结:"
  echo "   git clone https://github.com/David2kdw/mutsumi-world.git \"$EXT_DIR\""
  exit 1
fi

echo "📦 同步到 OpenClaw 扩展目录..."
cd "$EXT_DIR"

# 保存当前 HEAD 用于对比
OLD_HEAD=$(git rev-parse HEAD 2>/dev/null || echo "")

# 拉取最新
git fetch origin master
git reset --hard origin/master

NEW_HEAD=$(git rev-parse HEAD)

if [ "$OLD_HEAD" != "$NEW_HEAD" ]; then
  echo "📥 有新提交，更新中..."
  git --no-pager log --oneline ${OLD_HEAD:+$OLD_HEAD..}$NEW_HEAD 2>/dev/null || true
else
  echo "✅ 已是最新"
fi

# 安装依赖（package.json 有变更时）
echo "📦 检查依赖..."
npm install --silent 2>/dev/null || npm install

# 编译
echo "🔨 编译..."
npm run build

echo "✅ 同步完成。重启 OpenClaw Gateway 生效："
echo "   openclaw gateway stop && openclaw gateway start"
