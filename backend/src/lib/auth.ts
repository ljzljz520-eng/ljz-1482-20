import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config/env.js";

export interface AuthUser {
  sub: string;
  email: string;
  tenantId: string;
  name: string;
  role: string;
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: AuthUser;
    user: AuthUser;
  }
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  if (!config.jwtSecret) {
    return reply.code(503).send({ error: "AUTH_CONFIG_MISSING", message: "鉴权密钥未配置，服务拒绝以匿名模式运行。" });
  }
  try {
    await request.jwtVerify();
  } catch {
    return reply.code(401).send({ error: "UNAUTHORIZED", message: "登录状态无效或已过期。" });
  }
}

export function requireTenant(request: FastifyRequest, tenantId: string) {
  return request.user.tenantId === tenantId;
}
