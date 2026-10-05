import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { AppConfig, ConfigResult } from "../config/env";
import { registerHealthRoutes } from "./routes/health";
import { registerAuthRoutes } from "./routes/auth";
import { registerProjectRoutes } from "./routes/projects";
import { registerAssetRoutes } from "./routes/assets";
import { registerJobRoutes } from "./routes/jobs";
import { registerSelfcheckRoutes } from "./routes/selfcheck";

export async function buildApp(
  configResult: ConfigResult,
  config: AppConfig
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      transport:
        process.env.NODE_ENV === "production"
          ? undefined
          : { target: "pino-pretty", options: { colorize: false } },
    },
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(multipart, {
    limits: { fileSize: 20 * 1024 * 1024, files: 1 },
    throwFileSizeLimit: true,
  });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });

  // CORS 白名单：不在列表的浏览器来源被拒绝（验收项），同源/curl 无 Origin 不受限
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (config.corsOrigins.includes(origin)) return cb(null, true);
      app.log.warn({ origin }, "跨域来源不在白名单，已拒绝");
      cb(new Error(`CORS blocked: ${origin} 未在 CORS_ORIGINS 白名单中`), false);
    },
    credentials: true,
    allowedHeaders: ["Authorization", "Content-Type", "X-Client-Version", "X-Idempotency-Key"],
  });

  app.setErrorHandler((err, req, reply) => {
    if ((err as { statusCode?: number }).statusCode === 429) {
      return reply.code(429).send({ ok: false, code: "RATE_LIMITED", reason: "请求过于频繁，请稍后再试。" });
    }
    if ((err as Error).message.startsWith("CORS blocked")) {
      return reply.code(403).send({ ok: false, code: "CORS_BLOCKED", reason: err.message });
    }
    if ((err as { statusCode?: number }).statusCode === 400) {
      return reply.code(400).send({ ok: false, code: "BAD_REQUEST", reason: err.message });
    }
    req.log.error({ err: err.message, stack: err.stack }, "未处理错误");
    return reply.code(500).send({ ok: false, code: "INTERNAL", reason: "服务内部错误，请查看服务端日志。" });
  });

  registerHealthRoutes(app, configResult);
  registerAuthRoutes(app, config);
  registerProjectRoutes(app, config);
  registerAssetRoutes(app, config);
  registerJobRoutes(app, config);
  registerSelfcheckRoutes(app, config, configResult);

  return app;
}
