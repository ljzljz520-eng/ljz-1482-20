import type { FastifyInstance } from "fastify";
import { config, missingConfigKeys } from "../config/env.js";
import { runSelfCheck } from "../services/selfCheckService.js";

export default async function systemRoutes(app: FastifyInstance) {
  app.get("/health", async (_request, reply) => {
    const missing = missingConfigKeys();
    return reply.code(missing.length ? 503 : 200).send({
      status: missing.length ? "degraded" : "ok",
      environment: config.env,
      apiVersion: config.apiVersion,
      contractVersion: config.contractVersion,
      available: missing.length === 0,
      reason: missing.length ? "必需环境变量未配置，真实服务未就绪。" : undefined,
      requirements: missing.length ? missing : undefined
    });
  });

  app.get("/system/self-check", { onRequest: [app.authenticate] }, async (request) => {
    const query = request.query as { clientVersion?: string } | undefined;
    const clientVersion = String(request.headers["x-client-version"] ?? query?.clientVersion ?? "0.0.0");
    return runSelfCheck(request.user, clientVersion, request.headers.origin);
  });
}
