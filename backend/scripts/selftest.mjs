// 纯逻辑自检（无需数据库/对象存储）：版本协商、环境变量校验、密钥布尔化
import assert from "node:assert";
import { isCompatible, parseSemVer } from "../dist/selfcheck/version.js";
import { loadConfig, secretReadiness } from "../dist/config/env.js";

assert.deepStrictEqual(parseSemVer("1.4.0"), { major: 1, minor: 4, patch: 0 });
assert.equal(isCompatible("1.4.0", "1.4.0"), true);
assert.equal(isCompatible("1.4.1", "1.4.0"), true);
assert.equal(isCompatible("1.5.0", "1.4.0"), true);
assert.equal(isCompatible("1.3.9", "1.4.0"), false);
assert.equal(isCompatible("2.0.0", "1.4.0"), true);
assert.equal(isCompatible(undefined, "1.4.0"), false);

const r1 = loadConfig({});
for (const key of ["JWT_SECRET", "DATABASE_URL", "S3_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY", "PUBLIC_BASE_URL"]) {
  assert.ok(r1.missing.includes(key), `应检出缺失变量 ${key}`);
}
assert.ok(r1.errors.some((e) => e.includes("CORS_ORIGINS")));
assert.equal(r1.config?.storage.bucket, "workbench-preview");

const r2 = loadConfig({
  APP_ENV: "production",
  JWT_SECRET: "x".repeat(32),
  DATABASE_URL: "postgres://u:p@db:5432/prod",
  PUBLIC_BASE_URL: "https://api.x.com",
  CORS_ORIGINS: "https://app.x.com",
  S3_ENDPOINT: "minio",
  S3_ACCESS_KEY: "a",
  S3_SECRET_KEY: "b",
});
assert.equal(r2.missing.length, 0);
assert.equal(r2.config?.storage.bucket, "workbench-prod");
assert.equal(r2.config?.env, "production");

const secrets = secretReadiness(r2.config);
for (const v of Object.values(secrets)) assert.strictEqual(typeof v, "boolean");
assert.ok(!JSON.stringify(secrets).includes("x".repeat(32)), "密钥值不得出现在就绪性结果中");

// 非法 PUBLIC_BASE_URL 必须报错
const r3 = loadConfig({
  JWT_SECRET: "s", DATABASE_URL: "d", PUBLIC_BASE_URL: "not-a-url",
  CORS_ORIGINS: "http://x", S3_ENDPOINT: "e", S3_ACCESS_KEY: "a", S3_SECRET_KEY: "b",
});
assert.ok(r3.errors.some((e) => e.includes("PUBLIC_BASE_URL")));

console.log("backend logic self-test: PASS");
