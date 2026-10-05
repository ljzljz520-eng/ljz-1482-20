import { FastifyInstance } from "fastify";
import { AppConfig } from "../../config/env";
import { initPool } from "../../db/pool";
import { UserRepo } from "../../db/repos";
import { signToken, verifyPassword } from "../../auth";

interface LoginBody {
  username?: string;
  password?: string;
}

export function registerAuthRoutes(app: FastifyInstance, config: AppConfig) {
  app.post("/api/auth/login", async (req, reply) => {
    const body = req.body as LoginBody;
    if (!body?.username || !body?.password) {
      return reply.code(400).send({
        ok: false,
        code: "VALIDATION_ERROR",
        reason: "用户名和密码不能为空。",
      });
    }
    if (body.username.length > 64 || body.password.length > 200) {
      return reply.code(400).send({
        ok: false,
        code: "VALIDATION_ERROR",
        reason: "账号或密码长度非法。",
      });
    }
    const pool = initPool(config);
    const row = await new UserRepo(pool).findByUsername(body.username);
    // 用户不存在与密码失败使用相同文案，避免账号枚举
    if (!row || !(await verifyPassword(body.password, row.passwordHash))) {
      return reply.code(401).send({
        ok: false,
        code: "BAD_CREDENTIALS",
        reason: "用户名或密码错误。",
      });
    }
    const token = signToken(config, {
      id: row.id,
      tenantId: row.tenantId,
      username: row.username,
      displayName: row.displayName,
      role: row.role,
    });
    req.log.info({ tenantId: row.tenantId, username: row.username }, "用户登录");
    return {
      ok: true,
      token,
      user: {
        id: row.id,
        username: row.username,
        displayName: row.displayName,
        role: row.role,
        tenantId: row.tenantId,
      },
    };
  });
}
