#!/bin/bash
# Local Mac launcher. Paid AI stays disabled, including when .env contains a key.
set -euo pipefail
cd -- "$(dirname -- "$0")"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo 'Install Node.js 24 LTS for macOS from https://nodejs.org/en/download, then reopen Terminal.'
  exit 1
fi
node -e 'if (Number(process.versions.node.split(".")[0]) < 24) { console.error("Node.js 24 or newer is required. Install Node.js 24 LTS, then reopen Terminal."); process.exit(1); }'

export CHARCOAL_ENABLE_PAID_AI=false
export HOST=127.0.0.1
export PORT=3000

if [ ! -d node_modules/sharp ]; then
  echo 'Installing the website dependencies. No API key or paid service is required.'
  npm ci --omit=dev --ignore-scripts --no-audit --no-fund
fi

echo ''
echo 'Open Google Chrome on this Mac and enter: http://127.0.0.1:3000'
echo 'Keep this Terminal window open. Press Control-C here to stop the website.'
echo 'Paid AI analysis and image generation are disabled.'
echo ''
exec node --use-system-ca --use-env-proxy --env-file-if-exists=.env server/index.js
