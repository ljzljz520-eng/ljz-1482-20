import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { FastifyReply, FastifyRequest } from "fastify";
import { AppConfig } from "../config/env";
import { initPool } from "../db/pool";
import { UserRepo, UserRow } from "../db/repos";

export interface AuthContext {
  user: UserRow;
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signToken(config: AppConfig, user: UserRow): string {
  return jwt.sign(
    { sub: user.id, tid: user.tenantId, role: user.role, name: user.displayName },
    config.jwtSecret,
    { expiresIn: "12h", issuer: "creation-workbench" }
  );
}

export function verifyToken(config: AppConfig, token: string): jwt.JwtPayload {
  return jwt.verify(token, config.jwtSecret, { issuer: "creation-workbench" }) as jwt.JwtPayload;
}

export function authGuard(config: AppConfig) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      return reply.code(401).send({
        ok: false,
        code: "UNAUTHENTICATED",
        reason: "缺少 Bearer 令牌，请先登录。",
      });
    }
    let payload: jwt.JwtPayload;
    try {
      payload = verifyToken(config, header.slice(7));
    } catch {
      return reply.code(401).send({
        ok: false,
        code: "INVALID_TOKEN",
        reason: "令牌无效或已过期，请重新登录。",
      });
    }
    const pool = initPool(config);
    const user = await new UserRepo(pool).findById(String(payload.sub));
    if (!user) {
      return reply.code(401).send({
        ok: false,
        code: "USER_NOT_FOUND",
        reason: "令牌对应用户不存在（可能已被移除）。",
      });
    }
    if (user.tenantId !== payload.tid) {
      return reply.code(403).send({
        ok: false,
        code: "TENANT_MISMATCH",
        reason: "凭证与租户不匹配。",
      });
    }
    req.auth = { user };
  };
}

export function requireAuth(req: FastifyRequest): AuthContext {
  if (!req.auth) throw new Error("route used without authGuard");
  return req.auth;
}

/** 所有查询必须显式携带租户，防止越权读到其他租户数据 */
export function tenantScope(req: FastifyRequest): string {
  return requireAuth(req).user.tenantId;
}
