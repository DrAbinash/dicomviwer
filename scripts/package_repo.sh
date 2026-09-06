#!/usr/bin/env bash
# Package the dicomviwer repository into a deployable zip.
# Usage: bash scripts/package_repo.sh   (from the repository root)
set -euo pipefail

VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0")
OUT_DIR="${1:-/home/z/my-project/download}"
NAME="dicomviewer-v${VERSION}"
STAGE=$(mktemp -d)

mkdir -p "$OUT_DIR"
rsync -a --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude 'db' \
  --exclude '*.log' \
  --exclude '.env' \
  --exclude '.z-ai-config' \
  --exclude '.claude' \
  "$PWD/" "$STAGE/dicomviwer/"

(cd "$STAGE" && zip -qr "$OUT_DIR/$NAME.zip" dicomviwer)
rm -rf "$STAGE"
echo "packaged: $OUT_DIR/$NAME.zip"
