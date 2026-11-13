#!/usr/bin/env bash
# Cloudlead Infra Store - one-command local start (macOS / Linux)
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install the LTS version from https://nodejs.org and run this again."
  exit 1
fi
[ -d node_modules ] || npm install
[ -f .env ] || cp .env.example .env
[ -f data/cloudlead-infra.sqlite ] || npm run db:reset
( sleep 6; (command -v open >/dev/null && open http://localhost:4000) || (command -v xdg-open >/dev/null && xdg-open http://localhost:4000) || true ) &
npm start
