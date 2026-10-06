import Fastify, { type FastifyError, type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { config, missingConfigKeys } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { authenticate } from "./lib/auth.js";
import { ensureBucketReady } from "./lib/storage.js";
import { exportQueue, queueConnection } from "./lib/queue.js";
import { recoverStaleExports } from "./services/exportService.js";
import systemRoutes from "./routes/systemRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import callbackRoutes from "./routes/callbackRoutes.js";
import projectRoutes from "./routes/projectRoutes.js";
import assetRoutes from "./routes/assetRoutes.js";
import exportRoutes from "./routes/exportRoutes.js";

const app = Fastify({
  logger: false,
  bodyLimit: 2 * 1024 * 1024,
  trustProxy: true
});

app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
  (request as FastifyRequest & { rawBody?: string }).rawBody = String(body);
  if (!body) return done(null, undefined);
  try {
    done(null, JSON.parse(String(body)));
  } catch (error) {
    done(error as FastifyError, undefined);
  }
});

await app.register(cors, {
  origin: (origin, callback) => {
    if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
    callback(new Error("CORS origin rejected"), false);
  },
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization", "X-Client-Version", "X-Callback-Signature"],
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
});

if (config.jwtSecret) {
  await app.register(jwt, { secret: config.jwtSecret });
  app.decorate("authenticate", authenticate);
} else {
  app.decorate("authenticate", async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(503).send({ error: "AUTH_CONFIG_MISSING", message: "JWT_SECRET 未配置，受保护接口不可用。" });
  });
  logger.error("JWT_SECRET missing: protected APIs are disabled and no fallback data will be served");
}

app.decorateRequest("rawBody", "");

app.setErrorHandler((error, request, reply) => {
  const statusCode = error.statusCode ?? 500;
  if (error.message === "CORS origin rejected") {
    return reply.code(403).send({ error: "CORS_REJECTED", message: "来源未被允许；请在 CORS_ORIGIN 中配置当前预览域名。" });
  }
  logger.error("Request failed", {
    method: request.method,
    url: request.url,
    statusCode,
    error: error.message
  });
  return reply.code(statusCode).send({
    error: error.code ?? "INTERNAL_ERROR",
    message: statusCode === 500 ? "服务暂时不可用，请查看部署自检。" : error.message
  });
});

app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: "NOT_FOUND", message: "接口不存在。" }));

await app.register(systemRoutes, { prefix: "/api" });
await app.register(authRoutes, { prefix: "/api" });
await app.register(callbackRoutes, { prefix: "/api" });
await app.register(projectRoutes, { prefix: "/api" });
await app.register(assetRoutes, { prefix: "/api" });
await app.register(exportRoutes, { prefix: "/api" });

const missing = missingConfigKeys();
if (missing.length) {
  logger.error("Backend started in degraded mode; real integrations will not switch to fake data", { missing });
}

const start = async () => {
  if (!missing.length) {
    try {
      await ensureBucketReady();
      if (queueConnection) await queueConnection.ping();
      await recoverStaleExports(config.workerId);
      setInterval(() => {
        recoverStaleExports(config.workerId).catch((error) => logger.error("Recovery scan failed", { error: error.message }));
      }, 30_000).unref();
    } catch (error) {
      logger.error("Dependency warm-up failed; API remains available and self-check will report exact failure", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  await app.listen({ host: config.host, port: config.port });
  logger.info("API listening", { host: config.host, port: config.port, environment: config.env, degraded: missing.length > 0 });
};

const shutdown = async (signal: string) => {
  logger.info("API shutdown", { signal });
  await app.close();
  await exportQueue?.close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

start().catch((error) => {
  logger.error("Fatal startup error", { error: error.message });
  process.exit(1);
});
