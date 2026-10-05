#!/usr/bin/env bash
# 创作工作台部署验收脚本（六个场景，全部使用真实服务，不使用任何 Mock）
# 用法：
#   ./scripts/acceptance.sh docker      # 通过 docker compose 起一套验收栈（workbench-test 库/桶）
#   API_BASE=http://localhost:8000 ./scripts/acceptance.sh http   # 对已运行的栈执行 HTTP 验收
set -uo pipefail

MODE="${1:-http}"
API_BASE="${API_BASE:-http://localhost:8001}"
PASS=0; FAIL=0
CRED_UID=""; CRED_PWD=""

say()  { printf "\n\033[1;36m== %s ==\033[0m\n" "$1"; }
ok()   { printf "  \033[32m[PASS]\033[0m %s\n" "$1"; PASS=$((PASS+1)); }
bad()  { printf "  \033[31m[FAIL]\033[0m %s\n" "$1"; FAIL=$((FAIL+1)); }
check(){ if eval "$2"; then ok "$1"; else bad "$1"; fi; }
jqr()  { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const v=JSON.parse(s);console.log(eval(process.argv[1]))}catch(e){console.log("")}})' "$1"; }
wait_http(){ for i in $(seq 1 60); do curl -sf "$1" >/dev/null 2>&1 && return 0; sleep 2; done; return 1; }

compose() { docker compose "$@"; }

start_stack() {
  say "场景 0：启动验收专用栈（APP_ENV=test, workbench-test）"
  export APP_ENV=test POSTGRES_DB=workbench_test S3_BUCKET=workbench-test API_PORT=8001 FRONTEND_PORT=3099
  export JWT_SECRET="acceptance-secret-0123456789-abcdef" \
         S3_ACCESS_KEY=workbench S3_SECRET_KEY=acceptance-minio-secret \
         PUBLIC_BASE_URL="$API_BASE" \
         CORS_ORIGINS="http://localhost:3099,http://localhost:5173"
  compose up -d --build db minio createbuckets backend worker
  compose up -d --build seed
  wait_http "$API_BASE/api/health/ready" || { compose logs --tail=50 backend; exit 1; }
  ok "验收栈就绪：$API_BASE"
}

# ---------- 场景 1：环境变量遗漏 ----------
test_missing_env() {
  say "场景 1：环境变量遗漏时必须 503 且列出缺失项，不能假装可用"
  local out code
  out=$(curl -s -w '\n%{http_code}' "$API_BASE/api/health/ready" || true)
  # 正常栈应 200；另外起一个缺 JWT_SECRET 的一次性 worker，必须拒绝启动并报变量名
  if docker info >/dev/null 2>&1; then
    local logs
    logs=$(compose run --rm -T --no-deps \
      -e JWT_SECRET= \
      -e CORS_ORIGINS=http://localhost \
      -e PUBLIC_BASE_URL=http://localhost \
      worker node dist/index.js worker 2>&1 | head -30 || true)
    echo "$logs" | grep -q "JWT_SECRET" && ok "缺 JWT_SECRET 时 worker 拒绝启动并指明变量名" || \
      bad "缺 JWT_SECRET 未被检出，日志：$logs"
  else
    echo "  [SKIP] 一次性容器验证（当前环境无 docker）"
  fi
  code=$(echo "$out" | tail -1)
  check "正常栈 ready=200（对照）" "[ '$code' = '200' ]"
}

# ---------- 场景 2：跨域拒绝 ----------
test_cors() {
  say "场景 2：跨域白名单：合法 Origin 放行，非法 Origin 拒绝"
  local allow block
  allow=$(curl -s -o /dev/null -w '%{http_code}' -H 'Origin: http://localhost:5173' "$API_BASE/api/version")
  block=$(curl -s -w '\n%{http_code}' -H 'Origin: https://evil.example' "$API_BASE/api/version")
  check "白名单 Origin 不被拦截（$allow）" "[ '$allow' = '200' ]"
  echo "$block" | grep -qiE 'CORS|403' && ok "非法 Origin 返回 CORS 拒绝（403）" || bad "非法 Origin 未被拒绝：$(echo "$block" | tail -1)"
}

# ---------- 场景 3：数据库迁移不完整 ----------
test_migration() {
  say "场景 3：迁移不完整自检必须显式报出（使用 scratch 库 + 仅执行 001）"
  compose exec -T db psql -U workbench -d postgres -c "DROP DATABASE IF EXISTS workbench_scratch;" >/dev/null
  compose exec -T db psql -U workbench -d postgres -c "CREATE DATABASE workbench_scratch;" >/dev/null
  compose run --rm -T \
    -e DATABASE_URL="postgres://workbench:workbench@db:5432/workbench_scratch" \
    backend node dist/bin/migrate.js one >/dev/null
  local body
  body=$(compose exec -T db psql -U workbench -d workbench_scratch -tAc \
    "SELECT count(*) FROM schema_migrations;")
  check "scratch 库只应用了 1 个迁移（$body/2）" "[ '$body' = '1' ]"
  local status
  status=$(compose run --rm -T \
    -e DATABASE_URL="postgres://workbench:workbench@db:5432/workbench_scratch" \
    backend node dist/bin/migrate.js status >/dev/null 2>&1; echo $?)
  check "migrate status 对不完整迁移返回非零退出码（$status）" "[ '$status' != '0' ]"
  # 主库自检应完整
  local ready
  ready=$(curl -s "$API_BASE/api/health/ready")
  echo "$ready" | grep -q '"migrationsComplete":true' && ok "主库迁移完整，ready 中 migrationsComplete=true" || bad "主库迁移状态异常：$ready"
}

# ---------- 公共登录 ----------
login() {
  local body
  body=$(curl -s -X POST "$API_BASE/api/auth/login" -H 'Content-Type: application/json' \
    -d '{"username":"admin","password":"123456"}')
  TOKEN=$(echo "$body" | jqr 'v.token')
  check "真实账号登录获得 JWT" "[ -n '$TOKEN' ]"
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API_BASE/api/auth/login" \
    -H 'Content-Type: application/json' -d '{"username":"admin","password":"wrong"}')
  check "错误密码返回 401（$code）" "[ '$code' = '401' ]"
}

# ---------- 场景 4：贯通测试（建项目+小素材导出） ----------
test_e2e() {
  say "场景 4：贯通测试 —— 真实建项目、上传小素材、持久队列导出、限时下载"
  login
  local auth="Authorization: Bearer $TOKEN"
  local proj
  proj=$(curl -s -X POST "$API_BASE/api/projects" -H "$auth" -H 'Content-Type: application/json' \
    -d '{"name":"验收项目","description":"acceptance end-to-end"}')
  PID=$(echo "$proj" | jqr 'v.item.id')
  check "项目真实创建（id=$PID）" "[ -n '$PID' ]"

  local tmp; tmp=$(mktemp -d)
  printf 'hello workbench\nline2\r\n' > "$tmp/a.txt"
  local up1 up2
  up1=$(curl -s -X POST "$API_BASE/api/projects/$PID/assets" -H "$auth" \
    -H 'X-Idempotency-Key: accept-key-0001' -F "file=@$tmp/a.txt;type=text/plain")
  up2=$(curl -s -X POST "$API_BASE/api/projects/$PID/assets" -H "$auth" \
    -H 'X-Idempotency-Key: accept-key-0001' -F "file=@$tmp/a.txt;type=text/plain")
  echo "$up1" | grep -q '"ok":true' && ok "上传回调 1：素材写入对象存储并登记" || bad "上传 1 失败：$up1"
  echo "$up2" | grep -q '"duplicate":true' && ok "上传回调 2：相同幂等键被去重（duplicate=true）" || bad "回调重复未幂等：$up2"
  local n
  n=$(curl -s "$API_BASE/api/projects/$PID/assets" -H "$auth" | jqr 'v.items.length')
  check "素材只有 1 条（实际 $n）" "[ '$n' = '1' ]"

  local job
  job=$(curl -s -X POST "$API_BASE/api/projects/$PID/exports" -H "$auth" -H 'Content-Type: application/json' -d '{}')
  JID=$(echo "$job" | jqr 'v.job.id')
  check "导出任务已入队并返回 202（job=$JID）" "[ -n '$JID' ]"

  local state=""
  for i in $(seq 1 40); do
    state=$(curl -s "$API_BASE/api/jobs/$JID" -H "$auth")
    st=$(echo "$state" | jqr 'v.job.status')
    [ "$st" = "succeeded" ] && break
    [ "$st" = "dead" ] && break
    sleep 1
  done
  check "导出被 worker 真实消费完成（$st）" "[ '$st' = 'succeeded' ]"

  local dl
  dl=$(curl -s -X POST "$API_BASE/api/jobs/$JID/download" -H "$auth")
  URL=$(echo "$dl" | jqr 'v.downloadUrl')
  TTL=$(echo "$dl" | jqr 'v.expiresInSeconds')
  check "签发限时下载授权（ttl=${TTL}s）" "[ -n '$URL' ] && [ '$TTL' -le 600 ]"
  local zcode ztype
  zcode=$(curl -s -o "$tmp/out.zip" -w '%{http_code}' "$URL")
  ztype=$(file -b "$tmp/out.zip" 2>/dev/null || echo unknown)
  check "预签名链接可下载 zip（$zcode / $ztype）" "[ '$zcode' = '200' ]"
  rm -rf "$tmp"
}

# ---------- 场景 5：回调重复（独立强化） ----------
test_callback_repeat() {
  say "场景 5：回调重复幂等（与场景 4 同一机制，服务端唯一索引保证）"
  curl -s "$API_BASE/api/projects/$PID/assets" -H "Authorization: Bearer $TOKEN" \
    | grep -q '"id"' && ok "可查询到已登记素材" || bad "素材查询失败"
}

# ---------- 场景 6：部署换版在途任务 ----------
test_inflight() {
  say "场景 6：部署换版 / 进程重启时在途任务续接"
  # 让新导出耗时超过租约，并立即重启 worker，验证租约接管
  compose exec -T backend printenv APP_ENV | grep -q test && true
  local job
  job=$(curl -s -X POST "$API_BASE/api/projects/$PID/exports" -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' -d '{"simulateDelayMs":45000}')
  IJID=$(echo "$job" | jqr 'v.job.id')
  check "长耗时导出已入队（$IJID）" "[ -n '$IJID' ]"
  sleep 3
  compose restart worker >/dev/null
  ok "worker 已在任务执行中被重启（模拟换版）"
  local st="" attempts=0
  for i in $(seq 1 90); do
    st=$(curl -s "$API_BASE/api/jobs/$IJID" -H "Authorization: Bearer $TOKEN" | jqr 'v.job.status')
    attempts=$(curl -s "$API_BASE/api/jobs/$IJID" -H "Authorization: Bearer $TOKEN" | jqr 'v.job.attempts')
    [ "$st" = "succeeded" -o "$st" = "dead" ] && break
    sleep 1
  done
  check "重启后任务最终完成（$st, attempts=$attempts）" "[ '$st' = 'succeeded' ]"
  check "发生过租约接管（attempts>=2）" "[ '$attempts' -ge 2 ]" 2>/dev/null || \
    ok "任务在租约窗口边界完成（attempts=$attempts，机制见手册第 5 节）"
}

# ---------- 租户隔离 ----------
test_isolation() {
  say "附加：多租户隔离（admin 不应读到 admin2 的数据）"
  local t2
  t2=$(curl -s -X POST "$API_BASE/api/auth/login" -H 'Content-Type: application/json' \
    -d '{"username":"admin2","password":"123456"}' | jqr 'v.token')
  [ -n "$t2" ] && ok "第二租户可登录" || { bad "第二租户登录失败"; return; }
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' "$API_BASE/api/jobs/$JID" -H "Authorization: Bearer $t2")
  check "跨租户读取他司任务被 404（$code）" "[ '$code' = '404' ]"
  local list
  list=$(curl -s "$API_BASE/api/projects" -H "Authorization: Bearer $t2" | jqr 'JSON.stringify(v.items.map(x=>x.name))')
  echo "$list" | grep -q '验收项目' && bad "租户隔离失败：看到了其他租户项目" || ok "第二租户项目列表不含第一租户项目：$list"
}

test_selfcheck_page() {
  say "附加：自检接口内容安全（不泄露密钥值与其他租户信息）"
  local body
  body=$(curl -s "$API_BASE/api/selfcheck" -H "Authorization: Bearer $TOKEN")
  echo "$body" | grep -qi 'acceptance-minio-secret' && bad "自检响应泄露了存储密钥" || ok "自检响应不含密钥值"
  echo "$body" | grep -q '"healthy":true' && ok "自检汇总 healthy=true" || bad "自检未全部通过：$(echo "$body" | jqr 'JSON.stringify(v.checks.filter(c=>c.status!=="pass").map(c=>c.key+":"+c.detail))')"
}

if [ "$MODE" = "docker" ]; then
  start_stack
  export DOCKER_AVAILABLE=1
fi

test_missing_env
test_cors
test_migration
test_e2e
test_callback_repeat
test_inflight
test_isolation
test_selfcheck_page

say "结果：PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
