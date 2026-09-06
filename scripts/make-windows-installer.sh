#!/usr/bin/env bash
# =============================================================================
# make-windows-installer.sh - build the SIGNED Windows Setup.exe.
#
# Output (workspace download/):
#   DicomViewer-Setup-v<ver>-signed.exe          signed NSIS installer
#   dicomviewer-v<ver>-windows-installer.zip     signed Setup + cert + guide
#   dicomviewer-license-admin-kit-v<ver>.zip     keygen + PRIVATE key + cert
#
# Uses portable NSIS 3.12 + osslsigncode 2.9 extracted from Debian .debs
# into .cache/ (no root needed). Code-signing key: self-signed RSA cert in
# license-admin/codesign/ (generated on first run). When you buy a real
# OV/EV certificate, re-sign with the same osslsigncode command - see the
# vendor kit README.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"   # repo root
WS="$(dirname "$ROOT")"                    # workspace root
CACHE="$WS/.cache"
STAGE="$WS/win-staging-installer"
VER="$(node -p "require('$ROOT/package.json').version")"
MAKENSIS="$CACHE/nsis-root/usr/bin/makensis"
NSISDIR="$CACHE/nsis-root/usr/share/nsis"
OSSLSIGNCODE="$CACHE/ossl-root/usr/bin/osslsigncode"
SIGN_DIR="$ROOT/license-admin/codesign"
DL="$WS/download"

log() { printf '\n=== %s ===\n' "$*"; }

# ---------------------------------------------------------------- 0. precheck
log "0. precheck v$VER"
[ -f "$ROOT/.next/standalone/server.js" ] || { echo "ERROR: .next/standalone missing - run: bun run build"; exit 1; }
[ -f "$ROOT/node_modules/.prisma/client/query_engine-windows.dll.node" ] || { echo "ERROR: windows prisma engine missing - run: bunx prisma generate"; exit 1; }
[ -d "$ROOT/.next/standalone/node_modules/dcmjs-dimse" ] || { echo "ERROR: dcmjs-dimse not patched into standalone"; exit 1; }
[ -x "$MAKENSIS" ] || { echo "ERROR: makensis missing in $CACHE (debs not extracted)"; exit 1; }
[ -x "$OSSLSIGNCODE" ] || { echo "ERROR: osslsigncode missing in $CACHE"; exit 1; }
[ -f "$ROOT/license-admin/private.pem" ] || { echo "ERROR: license-admin/private.pem missing - run: node scripts/license-gen-keys.mjs"; exit 1; }

rm -rf "$STAGE"; mkdir -p "$STAGE/payload/app" "$STAGE/payload/runtime" "$STAGE/payload/template" "$DL"

# --------------------------------------------------- 1. app payload (Windows-ready)
log "1. stage standalone app"
cp -a "$ROOT/.next/standalone/." "$STAGE/payload/app/"

PRISMA_DLL="$STAGE/payload/app/node_modules/.prisma/client/query_engine-windows.dll.node"
if [ ! -f "$PRISMA_DLL" ]; then
  mkdir -p "$(dirname "$PRISMA_DLL")"
  cp "$ROOT/node_modules/.prisma/client/query_engine-windows.dll.node" "$PRISMA_DLL"
fi
if [ -d "$STAGE/payload/app/node_modules/sharp" ]; then
  SHARP_VER="$(node -p "require('$ROOT/node_modules/sharp/package.json').version")"
  echo "sharp $SHARP_VER - adding win32-x64 prebuilds"
  TGZ="$(ls "$CACHE"/*sharp-win32-x64-$SHARP_VER.tgz 2>/dev/null | head -1 || true)"
  if [ -z "$TGZ" ]; then
    (cd "$CACHE" && npm pack "@img/sharp-win32-x64@$SHARP_VER" >/dev/null 2>&1)
    TGZ="$(ls "$CACHE"/*sharp-win32-x64-$SHARP_VER.tgz 2>/dev/null | head -1)"
  fi
  mkdir -p "$STAGE/payload/app/node_modules/@img/sharp-win32-x64"
  tar -xzf "$TGZ" -C "$STAGE/payload/app/node_modules/@img/sharp-win32-x64" --strip-components=1
fi

log "1b. portable node.exe"
NODE_EXE_CACHE="$CACHE/node-win-x64.exe"
if [ ! -s "$NODE_EXE_CACHE" ]; then
  curl -fSL --retry 3 -o "$NODE_EXE_CACHE" "https://nodejs.org/dist/latest-v22.x/win-x64/node.exe"
fi
[ "$(stat -c%s "$NODE_EXE_CACHE")" -gt 50000000 ] || { echo "ERROR: node.exe cache looks wrong"; exit 1; }
cp "$NODE_EXE_CACHE" "$STAGE/payload/runtime/node.exe"

log "1c. template database + helpers"
cd "$ROOT"
DATABASE_URL="file:$STAGE/payload/template/custom.db" bunx prisma db push --accept-data-loss --skip-generate 2>&1 | tail -1
mkdir -p "$STAGE/payload/app/scripts"
cp "$ROOT/scripts/reset-admin.mjs" "$STAGE/payload/app/scripts/"
# installer-variant launchers + docs (cmd.exe needs CRLF)
for f in START-VIEWER.bat STOP-VIEWER.bat RESET-ADMIN.bat OPEN-FIREWALL-PORTS.bat README-INSTALL.txt; do
  sed 's/$/\r/' "$ROOT/windows-installer/$f" > "$STAGE/payload/$f"
done

# optional icon for shortcuts
rm -f "$STAGE/payload/viewer.ico"
if command -v magick >/dev/null 2>&1 && [ -f "$ROOT/public/icons/icon-512.png" ]; then
  magick "$ROOT/public/icons/icon-512.png" -define icon:auto-resize=256,128,64,48,32,16 "$STAGE/payload/viewer.ico" && ICON_OK=1 || ICON_OK=0
elif command -v convert >/dev/null 2>&1 && [ -f "$ROOT/public/icons/icon-512.png" ]; then
  convert "$ROOT/public/icons/icon-512.png" -resize 256x256 -resize 48x48 -resize 32x32 -resize 16x16 "$STAGE/payload/viewer.ico" && ICON_OK=1 || ICON_OK=0
else
  ICON_OK=0
fi
[ "$ICON_OK" = "1" ] && echo "shortcut icon: viewer.ico created" || echo "shortcut icon: skipped (no ImageMagick)"

# ------------------------------------------------------------- 2. NSIS build
log "2. makensis"
cp "$ROOT/windows-installer/LICENSE-TRIAL.txt" "$STAGE/"
cp "$ROOT/windows-installer/installer.nsi" "$STAGE/"
NSIS_EXTRA=""
[ "$ICON_OK" = "1" ] && NSIS_EXTRA="-DHAVE_ICON"
(cd "$STAGE" && NSISDIR="$NSISDIR" "$MAKENSIS" -V2 \
  "-DXVERMAJOR=${VER%%.*}" \
  "-DXVERMINOR=$(echo "$VER" | cut -d. -f2)" \
  "-DXVERPATCH=$(echo "$VER" | cut -d. -f3)" \
  "-DOUTFILE=DicomViewer-Setup-v$VER.exe" \
  $NSIS_EXTRA installer.nsi)
UNSIGNED="$STAGE/DicomViewer-Setup-v$VER.exe"
[ -s "$UNSIGNED" ] || { echo "ERROR: makensis produced no output"; exit 1; }
echo "unsigned setup: $(du -h "$UNSIGNED" | cut -f1)"

# ------------------------------------------------------- 3. code signing cert
log "3. signing"
mkdir -p "$SIGN_DIR"
if [ ! -s "$SIGN_DIR/key.pem" ] || [ ! -s "$SIGN_DIR/cert.pem" ]; then
  echo "generating self-signed code-signing certificate (10 years)"
  openssl req -x509 -newkey rsa:3072 -nodes -days 3650 \
    -keyout "$SIGN_DIR/key.pem" -out "$SIGN_DIR/cert.pem" \
    -subj "/CN=DICOM Viewer Vendor/O=Dicom Viewer Project/C=US" \
    -addext "extendedKeyUsage=codeSigning" \
    -addext "keyUsage=digitalSignature" >/dev/null
  openssl x509 -in "$SIGN_DIR/cert.pem" -outform der -out "$SIGN_DIR/cert.cer"
fi

SIGNED="$DL/DicomViewer-Setup-v$VER-signed.exe"
rm -f "$SIGNED"   # osslsigncode refuses to overwrite an existing output
SIGN_BASE=(-n "DICOM Viewer" -i "https://github.com/DrAbinash/dicomviwer"
           -certs "$SIGN_DIR/cert.pem" -key "$SIGN_DIR/key.pem")
if ! "$OSSLSIGNCODE" sign "${SIGN_BASE[@]}" \
    -t "http://timestamp.digicert.com" \
    -in "$UNSIGNED" -out "$SIGNED" 2>"$STAGE/sign.log"; then
  echo "timestamp server unreachable - signing without RFC3161 timestamp"
  "$OSSLSIGNCODE" sign "${SIGN_BASE[@]}" -in "$UNSIGNED" -out "$SIGNED" 2>>"$STAGE/sign.log"
fi
# verify against OUR cert (self-signed chain cannot validate against system trust)
"$OSSLSIGNCODE" verify -CAfile "$SIGN_DIR/cert.pem" "$SIGNED" | grep -E "Signature Index|Message digest algorithm|Succeeded" | head -4

# ---------------------------------------------------------------- 4. package
log "4. package deliverables"
rm -f "$DL/dicomviewer-v$VER-windows-installer.zip" "$DL/dicomviewer-license-admin-kit-v$VER.zip"
( cd "$STAGE" && zip -9 -q "$DL/dicomviewer-v$VER-windows-installer.zip" \
    "DicomViewer-Setup-v$VER.exe" )
( cd "$STAGE" && zip -9 -q "$DL/dicomviewer-v$VER-windows-installer.zip" -j \
    "$SIGN_DIR/cert.cer" "$ROOT/windows-installer/README-INSTALL.txt" )

# vendor kit: keygen + PRIVATE keys + how-to (NEVER commit license-admin/)
KIT="$DL/dicomviewer-license-admin-kit-v$VER.zip"
( cd "$ROOT/license-admin" && zip -9 -q "$KIT" \
    license-keygen.mjs private.pem public.pem README-VENDOR-KIT.md )
( cd "$ROOT/license-admin" && zip -9 -q "$KIT" -j codesign/key.pem codesign/cert.pem codesign/cert.cer )

# ---------------------------------------------------------------- 5. verify
log "5. verify"
check() { [ -e "$1" ] || { echo "MISSING: $1"; exit 1; }; echo "ok: $(basename "$1")  ($(du -h "$1" | cut -f1))"; }
check "$UNSIGNED"
check "$SIGNED"
check "$DL/dicomviewer-v$VER-windows-installer.zip"
check "$KIT"
"$OSSLSIGNCODE" verify -CAfile "$SIGN_DIR/cert.pem" "$SIGNED" >/dev/null 2>&1 \
  && echo "ok: Authenticode signature verifies (against vendor cert)" || { echo "FAIL: signature"; exit 1; }

echo
echo "==============================================================="
echo " INSTALLER OK v$VER"
echo "   signed setup : $SIGNED"
echo "   installer zip: $DL/dicomviewer-v$VER-windows-installer.zip"
echo "   vendor kit   : $KIT"
echo "==============================================================="
