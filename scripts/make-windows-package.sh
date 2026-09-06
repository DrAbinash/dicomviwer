#!/usr/bin/env bash
# =============================================================================
# make-windows-package.sh - build the OFFLINE Windows deployment zip.
#
# Output: <workspace>/download/dicomviewer-v0.6.0-windows.zip
#   dicomviewer-windows-v0.6.0/
#     app/            Next.js standalone build + node_modules (Windows-ready:
#                     Prisma windows engine + sharp win32 prebuilds included)
#     runtime/        portable node.exe (Node 22 LTS, win-x64)
#     app/db/custom.db   fresh pre-seeded SQLite database
#     *.bat + README-WINDOWS.txt
#
# Prerequisites (run from the repo root):
#   bun install
#   bunx prisma generate          (needs binaryTargets = ["native","windows"])
#   bun run build                 (next build + patch-standalone.js)
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"   # dicomviwer repo root
WS="$(dirname "$ROOT")"                    # workspace root
VER="$(node -p "require('$ROOT/package.json').version")"
STAGE="$WS/win-staging/dicomviewer-windows-v$VER"
CACHE="$WS/.cache"
ZIP="$WS/download/dicomviewer-v$VER-windows.zip"

log() { printf '\n=== %s ===\n' "$*"; }

# ---------------------------------------------------------------- 0. precheck
log "0. precheck"
[ -f "$ROOT/.next/standalone/server.js" ] || { echo "ERROR: .next/standalone missing - run: bun run build"; exit 1; }
[ -f "$ROOT/node_modules/.prisma/client/query_engine-windows.dll.node" ] || { echo "ERROR: windows prisma engine missing - run: bunx prisma generate (schema needs binaryTargets windows)"; exit 1; }
[ -d "$ROOT/.next/standalone/node_modules/dcmjs-dimse" ] || { echo "ERROR: dcmjs-dimse not patched into standalone - run: bun scripts/patch-standalone.js"; exit 1; }

# ------------------------------------------------------------ 1. clean staging
log "1. prepare staging $STAGE"
rm -rf "$WS/win-staging"
mkdir -p "$STAGE/app" "$STAGE/runtime" "$CACHE"

# --------------------------------------------------- 2. standalone app bundle
log "2. copy standalone build"
cp -a "$ROOT/.next/standalone/." "$STAGE/app/"

# ------------------------------------------------------- 3. windows binaries
log "3. windows-native binaries"
PRISMA_DLL="$STAGE/app/node_modules/.prisma/client/query_engine-windows.dll.node"
if [ ! -f "$PRISMA_DLL" ]; then
  mkdir -p "$(dirname "$PRISMA_DLL")"
  cp "$ROOT/node_modules/.prisma/client/query_engine-windows.dll.node" "$PRISMA_DLL"
fi
echo "prisma windows engine: $(du -h "$PRISMA_DLL" | cut -f1)"

# sharp win32 prebuilds (only if sharp itself is part of the standalone tree)
if [ -d "$STAGE/app/node_modules/sharp" ]; then
  SHARP_VER="$(node -p "require('$ROOT/node_modules/sharp/package.json').version")"
  echo "sharp $SHARP_VER detected - adding win32-x64 prebuilds"
  # note: for sharp >= 0.34, libvips is bundled INSIDE @img/sharp-win32-x64
  # (the separate @img/sharp-libvips-win32-x64 package no longer exists)
  for NAME in sharp-win32-x64; do
    # npm pack names scoped tarballs "img-<name>-<ver>.tgz" (scope @img -> img-)
    TGZ="$(ls "$CACHE"/*"$NAME-$SHARP_VER.tgz" 2>/dev/null | head -1 || true)"
    if [ -z "$TGZ" ]; then
      (cd "$CACHE" && npm pack "@img/$NAME@$SHARP_VER" >/dev/null 2>&1)
      TGZ="$(ls "$CACHE"/*"$NAME-$SHARP_VER.tgz" 2>/dev/null | head -1 || true)"
      [ -n "$TGZ" ] || { echo "ERROR: npm pack @img/$NAME@$SHARP_VER failed"; exit 1; }
    fi
    DEST="$STAGE/app/node_modules/@img/$NAME"
    mkdir -p "$DEST"
    tar -xzf "$TGZ" -C "$DEST" --strip-components=1
    echo "  + @img/$NAME"
  done
else
  echo "sharp not present in standalone - skipping win32 prebuilds"
fi

# ------------------------------------------------------- 4. portable node.exe
log "4. portable node.exe (win-x64)"
NODE_EXE_CACHE="$CACHE/node-win-x64.exe"
if [ ! -s "$NODE_EXE_CACHE" ]; then
  echo "downloading https://nodejs.org/dist/latest-v22.x/win-x64/node.exe ..."
  curl -fSL --retry 3 -o "$NODE_EXE_CACHE" "https://nodejs.org/dist/latest-v22.x/win-x64/node.exe"
fi
SIZE_MB=$(( $(stat -c%s "$NODE_EXE_CACHE") / 1024 / 1024 ))
[ "$SIZE_MB" -gt 50 ] || { echo "ERROR: node.exe download looks wrong ($SIZE_MB MB)"; exit 1; }
echo "node.exe: ${SIZE_MB} MB"
cp "$NODE_EXE_CACHE" "$STAGE/runtime/node.exe"

# ----------------------------------------------------- 5. fresh SQLite database
log "5. pre-seed SQLite database"
mkdir -p "$STAGE/app/db"
cd "$ROOT"
DATABASE_URL="file:$STAGE/app/db/custom.db" bunx prisma db push --accept-data-loss --skip-generate 2>&1 | tail -1
[ -s "$STAGE/app/db/custom.db" ] || { echo "ERROR: db push did not create the database"; exit 1; }

# ------------------------------------------------------- 6. helpers + scripts
log "6. bat helpers + reset-admin script"
mkdir -p "$STAGE/app/scripts"
cp "$ROOT/scripts/reset-admin.mjs" "$STAGE/app/scripts/reset-admin.mjs"
cp "$ROOT/windows/"*.bat "$STAGE/"
cp "$ROOT/windows/README-WINDOWS.txt" "$STAGE/"
# cmd.exe wants CRLF; the repo files are LF
sed -i 's/$/\r/' "$STAGE/"*.bat "$STAGE/README-WINDOWS.txt"

# ------------------------------------------------------------------ 7. zip it
log "7. create zip"
mkdir -p "$WS/download"
rm -f "$ZIP"
cd "$WS/win-staging"
zip -9 -rq "$ZIP" "dicomviewer-windows-v$VER"

# ---------------------------------------------------------------- 8. verify
log "8. verify package"
check() { [ -e "$STAGE/$1" ] || { echo "MISSING: $1"; exit 1; }; echo "ok: $1"; }
check "runtime/node.exe"
check "app/server.js"
check "app/db/custom.db"
check "app/scripts/reset-admin.mjs"
check "app/node_modules/.prisma/client/query_engine-windows.dll.node"
check "app/node_modules/dcmjs-dimse/package.json"
[ -d "$STAGE/app/node_modules/@img/sharp-win32-x64" ] && echo "ok: app/node_modules/@img/sharp-win32-x64"
check "START-VIEWER.bat"
check "STOP-VIEWER.bat"
check "OPEN-FIREWALL-PORTS.bat"
check "RESET-ADMIN.bat"
check "README-WINDOWS.txt"

FILES=$(unzip -l "$ZIP" | tail -1 | awk '{print $2}')
echo
echo "==============================================================="
echo " PACKAGE OK: $ZIP"
echo " entries: $FILES   size: $(du -h "$ZIP" | cut -f1)"
echo "==============================================================="