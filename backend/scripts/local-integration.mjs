// 本地全链路集成（无需 Docker）：embedded-postgres + minio 二进制 + 真实 API/worker。
// 用法：node scripts/local-integration.mjs
import { spawn } from "node:child_process";
import { once } from "node:events";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { mkdirSync } from "node:fs";

const ROOT = new URL("../", import.meta.url).pathname;
const MINIO_BIN = process.env.MINIO_BIN || "/tmp/bin/minio";
const PG_PORT = 55432;
const S3_PORT = 9100;
const API_PORT = 18000;
const DB_NAME = "wb_local";
const BASE = `http://127.0.0.1:${API_PORT}`;

const log = (...a) => console.log("[itest]", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const expect = (name, cond, extra = "") => {
  if (cond) console.log(`  \x1b[32mPASS\x1b[0m ${name}`);
  else { failures++; console.log(`  \x1b[31mFAIL\x1b[0m ${name} ${extra}`); }
};

async function waitFor(fn, label, timeout = 40000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      if (await fn()) return;
    } catch {}
    await sleep(500);
  }
  throw new Error(`timeout waiting for ${label}`);
}

// 清理上一轮可能残留的本集成专用进程（按端口/命令特征）
for (const port of [API_PORT, 9100, 19101, 19102]) {
  try {
    const out = spawn("sh", ["-c", `fuser -k ${port}/tcp 2>/dev/null || true`]);
    await once(out, "close");
  } catch {}
}

// 子进程以独立进程组启动，结束时整组回收，避免端口残留影响下一轮
const children = [];
function run(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { ...opts, detached: true });
  children.push(child);
  return child;
}
function killAll() {
  for (const c of children) {
    try { process.kill(-c.pid, "SIGKILL"); } catch {}
  }
}

// ---- 1. embedded postgres ----
log("starting embedded postgres");
const epg = new EmbeddedPostgres({
  databaseDir: `/tmp/epg-itest-${Date.now()}`,
  user: "node",
  password: "itest",
  port: PG_PORT,
  persistent: false,
});
await epg.initialise();
await epg.start();
const admin = new pg.Client({ host: "127.0.0.1", port: PG_PORT, user: "node", password: "itest", database: "postgres" });
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
await admin.query(`CREATE DATABASE ${DB_NAME}`);
await admin.end();

// ---- 2. minio ----
log("starting minio");
mkdirSync("/tmp/minio-itest", { recursive: true });
const minio = run(MINIO_BIN, ["server", "/tmp/minio-itest", "--address", `:${S3_PORT}`, "--console-address", ":9101"], {
  env: { ...process.env, MINIO_ROOT_USER: "itestak", MINIO_ROOT_PASSWORD: "itestsecret123" },
  stdio: "ignore",
});

const commonEnv = {
  ...process.env,
  APP_ENV: "test",
  JWT_SECRET: "itest-jwt-secret-0123456789-abcdef",
  DATABASE_URL: `postgres://node:itest@127.0.0.1:${PG_PORT}/${DB_NAME}`,
  PUBLIC_BASE_URL: BASE,
  CORS_ORIGINS: "http://localhost:5173",
  S3_ENDPOINT: "127.0.0.1",
  S3_INTERNAL_ENDPOINT: "127.0.0.1",
  S3_PORT: String(S3_PORT),
  S3_PUBLIC_ENDPOINT: "127.0.0.1",
  S3_PUBLIC_PORT: String(S3_PORT),
  S3_ACCESS_KEY: "itestak",
  S3_SECRET_KEY: "itestsecret123",
  S3_BUCKET: "workbench-local",
  QUEUE_LEASE_MS: "8000",
  QUEUE_HEARTBEAT_MS: "2000",
  AUTO_MIGRATE: "true",
  LOG_LEVEL: "warn",
};

const api = run("node", ["dist/index.js", "api"], { cwd: ROOT, env: { ...commonEnv, PORT: String(API_PORT) }, stdio: ["ignore","pipe","pipe"] });
api.stdout.on("data", (d) => process.stdout.write(`[api] ${d}`));
api.stderr.on("data", (d) => process.stderr.write(`[api] ${d}`));
const worker = run("node", ["dist/index.js", "worker"], { cwd: ROOT, env: { ...commonEnv, WORKER_NAME: "w1", WORKER_HEALTH_PORT: "19101" }, stdio: ["ignore","pipe","pipe"] });
worker.stdout.on("data", (d) => process.stdout.write(`[worker] ${d}`));
worker.stderr.on("data", (d) => process.stderr.write(`[worker] ${d}`));

async function apiFetch(path, init) {
  const res = await fetch(BASE + path, init);
  let body = null;
  try { body = await res.json(); } catch {}
  return { status: res.status, body, headers: res.headers };
}

try {
  await waitFor(async () => (await apiFetch("/api/health/live")).status === 200, "api live");
  await waitFor(async () => (await apiFetch("/api/health/ready")).status === 200, "api ready");
  log("services ready");

  // seed
  const seed = spawn("node", ["dist/bin/seed.js"], { cwd: ROOT, env: commonEnv, stdio: "inherit" });
  const [seedCode] = await once(seed, "exit");
  expect("seed 执行成功", seedCode === 0);

  // 版本兼容
  const v = await apiFetch("/api/version", { headers: { "X-Client-Version": "1.4.0" } });
  expect("版本兼容协商 compatible=true", v.body.compatible === true, JSON.stringify(v.body));
  const vold = await apiFetch("/api/version", { headers: { "X-Client-Version": "1.0.0" } });
  expect("旧前端版本被判定不兼容", vold.body.compatible === false);

  // CORS
  const corsAllow = await fetch(BASE + "/api/version", { headers: { Origin: "http://localhost:5173" } });
  expect("白名单 Origin 放行", corsAllow.status === 200);
  const corsBlock = await apiFetch("/api/version", { headers: { Origin: "https://evil.example" } });
  expect("非法 Origin 被 CORS 拒绝", corsBlock.status === 403, `got ${corsBlock.status}`);

  // 鉴权
  const noAuth = await apiFetch("/api/projects");
  expect("无令牌访问受保护接口=401", noAuth.status === 401);
  const badLogin = await apiFetch("/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "wrong" }),
  });
  expect("错误密码=401", badLogin.status === 401);
  const login = await apiFetch("/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "123456" }),
  });
  expect("正确登录获得 token", login.status === 200 && !!login.body.token);
  const token = login.body.token;
  const auth = { "Authorization": `Bearer ${token}`, "Content-Type": "application/json", "X-Client-Version": "1.4.0" };

  // 自检（等待 worker 就绪心跳，轮询队列检查项直到通过，最多 30s）
  let sc = null;
  await waitFor(async () => {
    sc = await apiFetch("/api/selfcheck", { headers: auth });
    const queueCheck = sc.body.checks?.find((c) => c.key === "queue");
    return queueCheck?.status === "pass";
  }, "worker heartbeat visible", 30000);
  expect("自检返回 200", sc.status === 200, JSON.stringify(sc.body).slice(0, 300));
  expect("自检无 fail 项", sc.body.summary.fail === 0, JSON.stringify(sc.body.checks?.filter((c) => c.status === "fail").map((c) => c.detail)));
  const raw = JSON.stringify(sc.body);
  expect("自检不包含密钥值", !raw.includes("itestsecret123") && !raw.includes("itest-jwt-secret"));
  expect("自检只展示密钥布尔", typeof sc.body.checks.find((c) => c.key === "config").meta.secrets.S3_SECRET_KEY === "boolean");

  // 建项目
  const proj = await apiFetch("/api/projects", {
    method: "POST", headers: auth,
    body: JSON.stringify({ name: "贯通测试项目", description: "e2e" }),
  });
  expect("真实创建项目", proj.status === 201 && !!proj.body.item.id, JSON.stringify(proj.body));
  const projectId = proj.body.item.id;

  // 上传小素材（multipart）
  const boundary = "----itestboundary";
  const fileContent = "line1\r\nline2\r\n创作工作台";
  const multipart = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="note.txt"`,
    "Content-Type: text/plain",
    "",
    fileContent,
    `--${boundary}--`,
    "",
  ].join("\r\n");
  const up1 = await apiFetch(`/api/projects/${projectId}/assets`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "X-Idempotency-Key": "itest-key-20261005-aaa",
      "X-Client-Version": "1.4.0",
    },
    body: multipart,
  });
  expect("上传回调1 成功", up1.status === 201, JSON.stringify(up1.body));
  const up2 = await apiFetch(`/api/projects/${projectId}/assets`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "X-Idempotency-Key": "itest-key-20261005-aaa",
      "X-Client-Version": "1.4.0",
    },
    body: multipart,
  });
  expect("上传回调2 幂等去重 duplicate=true", up2.status === 200 && up2.body.duplicate === true, JSON.stringify(up2.body));
  const assetList = await apiFetch(`/api/projects/${projectId}/assets`, { headers: auth });
  expect("素材仅 1 条", assetList.body.items.length === 1, `got ${assetList.body.items.length}`);

  // 导出
  const ex = await apiFetch(`/api/projects/${projectId}/exports`, {
    method: "POST", headers: auth, body: JSON.stringify({}),
  });
  expect("导出任务入队 202", ex.status === 202, JSON.stringify(ex.body));
  const jobId = ex.body.job.id;
  let job = null;
  await waitFor(async () => {
    const r = await apiFetch(`/api/jobs/${jobId}`, { headers: auth });
    job = r.body.job;
    return ["succeeded", "dead", "failed"].includes(job.status);
  }, "export completion", 30000);
  expect("worker 真实消费导出并成功", job.status === "succeeded", JSON.stringify(job));

  // 深度探针
  const deep = await apiFetch("/api/selfcheck/run-probes", { method: "POST", headers: auth, body: "{}" });
  expect("贯通探针全通过", deep.body.summary.fail === 0, JSON.stringify(deep.body.checks?.filter((c) => c.status === "fail")));

  // 下载授权
  const dl = await apiFetch(`/api/jobs/${jobId}/download`, { method: "POST", headers: auth, body: "{}" });
  expect("签发预签名下载链接", dl.status === 200 && !!dl.body.downloadUrl, JSON.stringify(dl.body));
  const zipRes = await fetch(dl.body.downloadUrl);
  expect("预签名 URL 可下载", zipRes.status === 200);
  const zipBytes = Buffer.from(await zipRes.arrayBuffer());
  expect("下载内容为 zip(PK 头)", zipBytes.subarray(0, 2).toString("ascii") === "PK", zipBytes.subarray(0,4).toString("hex"));

  // 跨租户隔离
  const login2 = await apiFetch("/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin2", password: "123456" }),
  });
  const token2 = login2.body.token;
  const cross = await apiFetch(`/api/jobs/${jobId}`, { headers: { Authorization: `Bearer ${token2}` } });
  expect("跨租户读任务=404", cross.status === 404, `got ${cross.status}`);
  const list2 = await apiFetch("/api/projects", { headers: { Authorization: `Bearer ${token2}` } });
  expect("跨租户看不到对方项目", !list2.body.items.some((p) => p.name === "贯通测试项目"));

  // 在途任务重启接管
  log("在途任务接管演练：启动一个 20s 导出，然后杀掉 worker 再拉起");
  const ex2 = await apiFetch(`/api/projects/${projectId}/exports`, {
    method: "POST", headers: auth, body: JSON.stringify({ simulateDelayMs: 20000 }),
  });
  const job2Id = ex2.body.job.id;
  await sleep(2000);
  worker.kill("SIGKILL");
  log("worker 已强杀（模拟崩溃/换版）");
  await sleep(1000);
  const worker2 = run("node", ["dist/index.js", "worker"], { cwd: ROOT, env: { ...commonEnv, WORKER_NAME: "w2", WORKER_HEALTH_PORT: "19102" }, stdio: ["ignore","pipe","pipe"] });
  worker2.stdout.on("data", (d) => process.stdout.write(`[worker2] ${d}`));
  worker2.stderr.on("data", (d) => process.stderr.write(`[worker2] ${d}`));
  let job2 = null;
  await waitFor(async () => {
    const r = await apiFetch(`/api/jobs/${job2Id}`, { headers: auth });
    job2 = r.body.job;
    return ["succeeded", "dead"].includes(job2.status);
  }, "inflight recovery", 60000);
  expect("崩溃后在途任务被新 worker 接管并成功", job2.status === "succeeded", JSON.stringify(job2));
  expect("任务尝试次数 >= 2（发生接管）", job2.attempts >= 2, `attempts=${job2.attempts}`);
  worker2.kill("SIGTERM");
} catch (err) {
  failures++;
  console.error("itest fatal", err);
} finally {
  killAll();
  await sleep(500);
  await epg.stop();
  console.log(failures === 0 ? "\nLOCAL INTEGRATION: ALL PASS" : `\nLOCAL INTEGRATION: ${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}
