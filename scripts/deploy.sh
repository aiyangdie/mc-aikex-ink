#!/usr/bin/env bash
# 生产机上线脚本（由 GitHub Actions self-hosted runner 调用）
set -euo pipefail

ROOT="${DEPLOY_ROOT:-/www/wwwroot/mc.aikex.ink}"
cd "$ROOT"

# Actions runner / 属主不一致时绕过 dubious ownership（不依赖 HOME/.gitconfig）
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0=safe.directory
export GIT_CONFIG_VALUE_0="$ROOT"

echo "[deploy] $(date -Is) pull…"
git -c safe.directory="$ROOT" fetch origin main
git -c safe.directory="$ROOT" reset --hard origin/main

cd "$ROOT"
# Boss/collision 服务端会 import ../js/voxel.js → 需要根目录 three（勿全量装 playwright）
if [[ ! -d node_modules/three ]]; then
  npm install three@0.160.0 --no-save --omit=dev
fi

cd "$ROOT/server"
if [[ ! -f ecosystem.config.cjs ]]; then
  cp ecosystem.config.cjs.example ecosystem.config.cjs
  echo "[deploy] WARN: created ecosystem.config.cjs from example — set MC_OWNER_KEY"
fi
if grep -q "change-me-owner-key\|aikex-mc-2026" ecosystem.config.cjs 2>/dev/null; then
  echo "[deploy] WARN: MC_OWNER_KEY still looks like a default — rotate before public use"
fi
npm install --omit=dev
mkdir -p data
[[ -f data/admins.json ]] || cp data/admins.json.example data/admins.json 2>/dev/null || echo '{"version":1,"admins":[]}' > data/admins.json
[[ -f data/catalog.json ]] || echo '{"version":1,"mobs":[],"items":[],"structures":[]}' > data/catalog.json

pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
echo "[deploy] done"
