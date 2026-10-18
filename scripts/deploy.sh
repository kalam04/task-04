#!/usr/bin/env bash
# Update the live server from GitHub: backup → set aside server-side edits → pull → install → build → restart → check.
#   npm run deploy
set -euo pipefail

cd "$(dirname "$0")/.."
APP_NAME="task-management"
PORT="$(grep -E '^PORT=' backend/.env 2>/dev/null | cut -d= -f2 || true)"
PORT="${PORT:-4000}"

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[1;31m✗ %s\033[0m\n' "$1"; exit 1; }

[ -d .git ] || fail "This folder is not a git repository. See DEPLOY.md (Updating) for the one-time setup."
[ -f backend/.env ] || fail "backend/.env is missing. Create it first (DEPLOY.md step 4)."

step "Backing up the database"
npm run backup --silent

step "Setting aside any edits made directly on this server"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  git status --short --untracked-files=no
  git stash push -m "server edits before deploy $(date +%F-%H%M)"
  echo "Saved with git stash (see them with: git stash list / git stash show -p)."
else
  echo "No local edits."
fi

step "Pulling the latest code from GitHub"
BEFORE="$(git rev-parse --short HEAD)"
git pull --ff-only origin main
AFTER="$(git rev-parse --short HEAD)"
if [ "$BEFORE" = "$AFTER" ]; then echo "Already up to date ($AFTER)."; else git log --oneline "$BEFORE..$AFTER"; fi

step "Installing packages"
npm run install:all --silent

step "Building the app"
npm run build --silent

step "Restarting"
if pm2 describe "$APP_NAME" > /dev/null 2>&1; then
  pm2 restart "$APP_NAME" --update-env
else
  pm2 start ecosystem.config.cjs
  pm2 save
fi

step "Checking the app is up"
for i in $(seq 1 15); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" > /dev/null 2>&1; then
    printf '\n\033[1;32m✓ Deployed %s — the app is running.\033[0m\n' "$AFTER"
    exit 0
  fi
  sleep 1
done
pm2 logs "$APP_NAME" --lines 40 --nostream || true
fail "The app did not come up on port ${PORT}. See the log lines above."
