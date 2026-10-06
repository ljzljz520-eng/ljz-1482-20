import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { config } from "../config/env.js";
import { prisma } from "../lib/prisma.js";

const loginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(6).max(200)
});

export default async function authRoutes(app: FastifyInstance) {
  app.post("/auth/login", async (request, reply) => {
    if (!config.jwtSecret) {
      return reply.code(503).send({ error: "AUTH_CONFIG_MISSING", message: "鉴权未配置；禁止无凭据访问。" });
    }
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "VALIDATION_ERROR", message: "邮箱或密码格式不正确。", details: parsed.error.flatten() });
    }

    const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() }, include: { tenant: true } });
    if (!user) {
      return reply.code(401).send({ error: "INVALID_CREDENTIALS", message: "邮箱或密码错误。" });
    }
    const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
    if (!valid) {
      return reply.code(401).send({ error: "INVALID_CREDENTIALS", message: "邮箱或密码错误。" });
    }

    const token = await reply.jwtSign({
      sub: user.id,
      email: user.email,
      tenantId: user.tenantId,
      name: user.name,
      role: user.role
    });
    return {
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenantId, tenant: { id: user.tenantId, name: user.tenant.name } },
      environment: config.env
    };
  });

  app.get("/auth/me", { onRequest: [app.authenticate] }, async (request) => ({
    id: request.user.sub,
    email: request.user.email,
    name: request.user.name,
    role: request.user.role,
    tenantId: request.user.tenantId,
    environment: config.env
  }));
}
