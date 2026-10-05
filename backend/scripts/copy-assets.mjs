// 将 SQL 迁移文件复制到编译产物中，保证容器内 dist 可独立运行。
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const from = "src/db/migrations";
const to = "dist/db/migrations";
mkdirSync(dirname(to), { recursive: true });
if (existsSync(from)) {
  cpSync(from, to, { recursive: true });
}
console.log("[build] migrations copied to", to);
