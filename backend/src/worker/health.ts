import { createServer } from "node:http";

/** 独立 worker 存活探针，docker healthcheck / 编排平台使用 */
export function startHealthServer(port: number): void {
  const server = createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, ts: Date.now() }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(port, "0.0.0.0");
}
