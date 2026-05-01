#!/usr/bin/env bash
# LaputaMediaCenter — macOS / Linux installer
# Reads required versions from package.json (single source of truth: engines.node + packageManager).

set -euo pipefail

echo "=== LaputaMediaCenter installer ==="
echo

# 1. Read required versions from package.json (use node itself; require it first)
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node not found on PATH. Install Node 24+ from https://nodejs.org" >&2
  exit 1
fi

REQUIRED_NODE=$(node -p "require('./package.json').engines.node.replace(/[^\d.]/g, '').split('.')[0]")
REQUIRED_PNPM=$(node -p "require('./package.json').packageManager.replace(/^pnpm@/, '')")
REQUIRED_PNPM_MAJOR="${REQUIRED_PNPM%%.*}"

echo "Required: Node >= $REQUIRED_NODE, pnpm $REQUIRED_PNPM"

# 2. Check Node version
NODE_VER=$(node --version | sed 's/^v//')
NODE_MAJOR="${NODE_VER%%.*}"
if [ "$NODE_MAJOR" -lt "$REQUIRED_NODE" ]; then
  echo "❌ Node $NODE_VER is too old. Need >= $REQUIRED_NODE. Install from https://nodejs.org" >&2
  exit 1
fi
echo "✓ Node $NODE_VER"

# 3. Check pnpm
if ! command -v pnpm >/dev/null 2>&1; then
  echo "❌ pnpm not found. Install with: npm install -g pnpm@$REQUIRED_PNPM" >&2
  exit 1
fi
PNPM_VER=$(pnpm --version)
PNPM_MAJOR="${PNPM_VER%%.*}"
if [ "$PNPM_MAJOR" -lt "$REQUIRED_PNPM_MAJOR" ]; then
  echo "⚠️ pnpm $PNPM_VER is older than recommended $REQUIRED_PNPM. Continuing in 3s (Ctrl+C to abort)..."
  sleep 3
else
  echo "✓ pnpm $PNPM_VER"
fi

# 4. Soft-check native tools (warn only)
for tool in ffmpeg yt-dlp; do
  if command -v "$tool" >/dev/null 2>&1; then
    echo "✓ $tool on PATH"
  else
    echo "⚠️ $tool not on PATH (needed for /ingest /highlights /dubbing)."
  fi
done
echo "   whisper.cpp will auto-download to ~/.laputa/whisper/ on first ASR run."
echo

# 5. Install + init DB
echo "→ pnpm install ..."
pnpm install

echo "→ pnpm db:init ..."
pnpm db:init

echo
echo "✅ Install complete."
echo
echo "   Run dev server: pnpm dev   (http://localhost:8899)"
echo "   Run E2E tests:  pnpm test:e2e"
echo "   See README.md / README.en.md for next steps."
