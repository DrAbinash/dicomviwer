#!/usr/bin/env bash
# =============================================================================
# license-e2e.sh - end-to-end verification of the trial licensing system
# against the REAL standalone build, driven with plain node + curl.
#
# Phases:
#   A  no license        -> activation gate, login/API blocked
#   B  trial activated   -> app renders, login + APIs work, DIMSE echo works
#   C  expiry AT RUNTIME (license file swapped while server keeps running,
#      memo TTL elapses) -> APIs + external C-ECHO start refusing, gate shows
#                          the expiry date, expired key cannot be re-activated
#   D  clock tamper      -> locked while running, fresh key unlocks live
#   E  perpetual key     -> valid, no expiry
# =============================================================================
set -u
cd "$(dirname "$0")/.."   # repo root

ROOT="$PWD"
DATA="/tmp/lic-e2e"
PORT=4599
DIMSE_PORT=4598
DB="$DATA/custom.db"
PASS=0; FAIL=0
SRV_PID=""

say()  { printf '\n== %s ==\n' "$*"; }
ok()   { PASS=$((PASS+1)); echo "  ok: $*"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL: $*"; }

start_server() {
  NODE_ENV=production PORT=$PORT HOSTNAME=127.0.0.1 \
  DATABASE_URL="file:$DB" \
  DVV_LICENSE_FILE="$DATA/license.key" \
  DVV_LISTEN_PORT=$DIMSE_PORT \
  node "$ROOT/.next/standalone/server.js" >>"$DATA/server.log" 2>&1 &
  SRV_PID=$!
  for _ in $(seq 1 40); do
    curl -sf -o /dev/null "http://127.0.0.1:$PORT/api/license" && return 0
    sleep 0.5
  done
  echo "server did not come up"; tail -20 "$DATA/server.log"; exit 1
}

stop_server() {
  [ -n "$SRV_PID" ] && kill "$SRV_PID" 2>/dev/null
  wait "$SRV_PID" 2>/dev/null
  SRV_PID=""
  sleep 0.5
}

# the license module memoizes status for 30 s; runtime swaps need this wait
wait_memo() { echo "  (waiting 31 s for the 30 s license memo to elapse...)"; sleep 31; }

api_license()  { curl -s "http://127.0.0.1:$PORT/api/license"; }
state_of()     { printf '%s' "$1" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).license.state)}catch(e){console.log('parse-error')}})"; }
# blocked = 401 (middleware short-circuit) or 403 (requireSession license gate)
assert_blocked() {
  local CODE="$1" WHAT="$2"
  case "$CODE" in 401|403) ok "$WHAT (HTTP $CODE)";; *) bad "$WHAT code=$CODE";; esac
}
ext_echo() { node scripts/dimse-echo-client.mjs $DIMSE_PORT DICOMVIEWER >"$DATA/echo.log" 2>&1; echo $?; }

pkill -9 -f next-server 2>/dev/null
sleep 1
rm -rf "$DATA"; mkdir -p "$DATA"
: > "$DATA/server.log"

say "0. fresh database"
DATABASE_URL="file:$DB" bunx prisma db push --accept-data-loss --skip-generate >/dev/null 2>&1 \
  && ok "db pushed" || bad "db push"

say "A. no license installed"
start_server
S=$(state_of "$(api_license)")
[ "$S" = "none" ] && ok "license state = none" || bad "expected none, got $S"
PAGE=$(curl -sL "http://127.0.0.1:$PORT/")
printf '%s' "$PAGE" | grep -q 'license-key' && ok "GET / shows activation gate" || bad "gate missing on /"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin"}' "http://127.0.0.1:$PORT/api/auth/login")
assert_blocked "$CODE" "login blocked while unlicensed"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/pacs-servers")
assert_blocked "$CODE" "API blocked while unlicensed"

say "B. activate 30-day trial key"
KEY=$(cat /tmp/test-trial.key)
R=$(curl -s -X POST -H 'Content-Type: application/json' -d "{\"key\":\"$KEY\"}" \
  "http://127.0.0.1:$PORT/api/license")
S=$(state_of "$R")
[ "$S" = "valid" ] && ok "activation -> valid" || bad "activation state=$S ($R)"
PAGE=$(curl -sL "http://127.0.0.1:$PORT/")
printf '%s' "$PAGE" | grep -q 'license-key' && bad "gate still shown after activation" || ok "GET / renders the app (no gate)"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -c "$DATA/cookies.txt" -X POST -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin"}' "http://127.0.0.1:$PORT/api/auth/login")
[ "$CODE" = "200" ] && ok "login works once licensed" || bad "login code=$CODE"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$DATA/cookies.txt" "http://127.0.0.1:$PORT/api/pacs-servers")
[ "$CODE" = "200" ] && ok "authenticated API works (200)" || bad "pacs-servers code=$CODE"
DAYS=$(printf '%s' "$(api_license)" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{console.log(JSON.parse(d).license.daysLeft)})")
[ "${DAYS:-0}" -ge 29 ] 2>/dev/null && ok "daysLeft plausible ($DAYS)" || bad "daysLeft=$DAYS"
# enable our own listener + self-echo through the app
curl -s -b "$DATA/cookies.txt" -X PUT -H 'Content-Type: application/json' \
  -d "{\"enabled\":true,\"aeTitle\":\"DICOMVIEWER\",\"port\":$DIMSE_PORT}" \
  "http://127.0.0.1:$PORT/api/dimse/listener" >/dev/null
sleep 1
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$DATA/cookies.txt" -X POST -H 'Content-Type: application/json' \
  -d "{\"host\":\"127.0.0.1\",\"port\":$DIMSE_PORT,\"aeTitle\":\"DICOMVIEWER\"}" \
  "http://127.0.0.1:$PORT/api/dimse/echo")
[ "$CODE" = "200" ] && ok "self C-ECHO via app (200)" || bad "self echo code=$CODE"
RC=$(ext_echo)
[ "$RC" = "0" ] && ok "external C-ECHO accepted when licensed" || bad "echo exit=$RC ($(tail -2 "$DATA/echo.log"))"

say "C. trial expires AT RUNTIME (license file swapped, server stays up)"
cp /tmp/test-expired.key "$DATA/license.key"
wait_memo
S=$(state_of "$(api_license)")
[ "$S" = "expired" ] && ok "runtime detection -> expired" || bad "expected expired, got $S"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$DATA/cookies.txt" "http://127.0.0.1:$PORT/api/pacs-servers")
assert_blocked "$CODE" "APIs refuse even with a valid session cookie"
RC=$(ext_echo)
[ "$RC" = "3" ] && ok "external C-ECHO rejected after expiry" || bad "echo exit=$RC ($(tail -2 "$DATA/echo.log"))"
PAGE=$(curl -sL "http://127.0.0.1:$PORT/")
printf '%s' "$PAGE" | grep -q 'expired on 2020-01-01' && ok "gate names the expiry date" || bad "expiry text missing"
R=$(curl -s -X POST -H 'Content-Type: application/json' -d "{\"key\":\"$(cat /tmp/test-expired.key)\"}" \
  "http://127.0.0.1:$PORT/api/license")
printf '%s' "$R" | grep -q 'already expired' && ok "activating an expired key is refused" || bad "expired activation: $R"

say "D. clock rollback -> locked live, fresh key unlocks live"
cp /tmp/test-trial2.key "$DATA/license.key"
R=$(curl -s -X POST -H 'Content-Type: application/json' -d "{\"key\":\"$(cat /tmp/test-trial2.key)\"}" \
  "http://127.0.0.1:$PORT/api/license")
S=$(state_of "$R")
[ "$S" = "valid" ] && ok "trial #2 active again" || bad "trial2 state=$S"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$DATA/cookies.txt" "http://127.0.0.1:$PORT/api/pacs-servers")
[ "$CODE" = "200" ] && ok "APIs work again with fresh key" || bad "pacs-servers code=$CODE"
# simulate rollback detection, wait out the memo
printf '{"locked":true}' > "$DATA/.licstate.json"
wait_memo
S=$(state_of "$(api_license)")
[ "$S" = "locked" ] && ok "tamper -> locked (live)" || bad "expected locked, got $S"
RC=$(ext_echo)
[ "$RC" = "3" ] && ok "DIMSE rejected while locked" || bad "echo exit=$RC ($(tail -2 "$DATA/echo.log"))"
R=$(curl -s -X POST -H 'Content-Type: application/json' -d "{\"key\":\"$(cat /tmp/test-trial.key)\"}" \
  "http://127.0.0.1:$PORT/api/license")
S=$(state_of "$R")
[ "$S" = "valid" ] && ok "FRESH key unlocks a locked box" || bad "unlock state=$S ($R)"

say "E. perpetual key (your own full license)"
R=$(curl -s -X POST -H 'Content-Type: application/json' -d "{\"key\":\"$(cat /tmp/test-perp.key)\"}" \
  "http://127.0.0.1:$PORT/api/license")
S=$(state_of "$R")
TYP=$(printf '%s' "$R" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{console.log(JSON.parse(d).license.typ)})")
[ "$S" = "valid" ] && [ "$TYP" = "perpetual" ] && ok "perpetual license valid" || bad "perpetual: state=$S typ=$TYP"
RC=$(ext_echo)
[ "$RC" = "0" ] && ok "DIMSE accepted again" || bad "echo exit=$RC"
stop_server

say "RESULT"
echo "  PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ] || exit 1
echo "ALL LICENSE E2E CHECKS PASSED"
