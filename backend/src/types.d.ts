import type { FastifyReply, FastifyRequest } from "fastify";
import type { authenticate } from "./lib/auth.js";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: typeof authenticate;
  }
  interface FastifyRequest {
    rawBody?: string;
  }
}

export type AuthenticatedRequest = FastifyRequest;
export type AppReply = FastifyReply;
