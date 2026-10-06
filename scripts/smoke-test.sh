#!/usr/bin/env sh
set -eu

BASE_URL="${BASE_URL:-http://localhost:3001/api}"
EMAIL="${SMOKE_EMAIL:-admin@example.com}"
PASSWORD="${SMOKE_PASSWORD:-Workbench@2026}"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

log() { printf '\n==> %s\n' "$1"; }
fail() { printf '\nSMOKE TEST FAILED: %s\n' "$1" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || fail "curl is required"
command -v ffmpeg >/dev/null 2>&1 || fail "ffmpeg is required on host for generating test WAV"
command -v unzip >/dev/null 2>&1 || fail "unzip is required"
command -v jq >/dev/null 2>&1 || fail "jq is required"

log "Health and self check"
curl -fsS "$BASE_URL/health" | jq -e '.available == true' >/dev/null
LOGIN_JSON="$TMP_DIR/login.json"
HTTP_CODE=$(curl -sS -o "$LOGIN_JSON" -w '%{http_code}' -X POST "$BASE_URL/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
[ "$HTTP_CODE" = "200" ] || fail "login failed with HTTP $HTTP_CODE: $(cat "$LOGIN_JSON")"
TOKEN=$(jq -r .token "$LOGIN_JSON")
[ -n "$TOKEN" ] || fail "login token missing"
curl -fsS "$BASE_URL/system/self-check" -H "Authorization: Bearer $TOKEN" -H 'X-Client-Version: 1.0.0' | jq -e '.status == "pass" and ([.checks[].name] | index("queueConsumer")) and ([.checks[].name] | index("uploadCallback"))' >/dev/null

log "Create a real project"
PROJECT_ID=$(curl -fsS -X POST "$BASE_URL/projects" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"name\":\"Smoke $(date +%s)\",\"description\":\"real end-to-end smoke test\"}" | jq -r .id)

log "Create a one-second WAV and request a presigned upload"
ffmpeg -hide_banner -loglevel error -f lavfi -i "sine=frequency=440:duration=1" -ar 8000 -ac 1 "$TMP_DIR/sample.wav"
SIZE=$(wc -c < "$TMP_DIR/sample.wav")
UPLOAD_JSON="$TMP_DIR/upload.json"
curl -fsS -X POST "$BASE_URL/assets/upload-url" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"projectId\":\"$PROJECT_ID\",\"filename\":\"sample.wav\",\"contentType\":\"audio/wav\",\"sizeBytes\":$SIZE}" > "$UPLOAD_JSON"
curl -fsS -X PUT -T "$TMP_DIR/sample.wav" -H 'Content-Type: audio/wav' "$(jq -r .uploadUrl "$UPLOAD_JSON")" >/dev/null
EVENT_ID="smoke-$(date +%s)-$$"
curl -fsS -X POST "$BASE_URL/callbacks/uploads/presigned" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "$(jq -n --arg event "$EVENT_ID" --arg tenant "$(jq -r .callbackConfirmation.tenantId "$UPLOAD_JSON")" --arg key "$(jq -r .callbackConfirmation.objectKey "$UPLOAD_JSON")" --arg token "$(jq -r .callbackConfirmation.token "$UPLOAD_JSON")" --argjson expires "$(jq -r .callbackConfirmation.expiresAt "$UPLOAD_JSON")" '{eventId:$event,tenantId:$tenant,objectKey:$key,expiresAt:$expires,token:$token,eventType:"object.created"}')" | jq -e '.status == "processed"' >/dev/null

log "Verify duplicate callback is idempotent"
curl -fsS -X POST "$BASE_URL/callbacks/uploads/presigned" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "$(jq -n --arg event "$EVENT_ID" --arg tenant "$(jq -r .callbackConfirmation.tenantId "$UPLOAD_JSON")" --arg key "$(jq -r .callbackConfirmation.objectKey "$UPLOAD_JSON")" --arg token "$(jq -r .callbackConfirmation.token "$UPLOAD_JSON")" --argjson expires "$(jq -r .callbackConfirmation.expiresAt "$UPLOAD_JSON")" '{eventId:$event,tenantId:$tenant,objectKey:$key,expiresAt:$expires,token:$token,eventType:"object.created"}')" | jq -e '.duplicate == true' >/dev/null

log "Submit durable export and poll until success"
EXPORT_ID=$(curl -fsS -X POST "$BASE_URL/exports" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"projectId\":\"$PROJECT_ID\",\"idempotencyKey\":\"smoke-$$-$(date +%s)\"}" | jq -r .job.id)
STATUS=""
i=0
while [ "$STATUS" != "succeeded" ]; do
  i=$((i + 1)); [ "$i" -le 40 ] || fail "export did not finish in time"
  sleep 1
  STATUS=$(curl -fsS "$BASE_URL/exports/$EXPORT_ID" -H "Authorization: Bearer $TOKEN" | tee "$TMP_DIR/export.json" | jq -r .status)
  [ "$STATUS" != "failed" ] || fail "$(jq -r .error "$TMP_DIR/export.json")"
done
URL=$(jq -r .downloadUrl "$TMP_DIR/export.json")
[ "$URL" != "null" ] || fail "signed download URL missing"
curl -fsS -L "$URL" -o "$TMP_DIR/export.zip"
unzip -l "$TMP_DIR/export.zip" | grep -E 'manifest.json|asset-1.mp3' >/dev/null

log "SMOKE TEST PASSED: real project, upload callback, durable queue, signed download"
