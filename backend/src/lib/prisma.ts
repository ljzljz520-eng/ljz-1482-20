import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient({
  log: [
    { level: "warn", emit: "event" },
    { level: "error", emit: "event" }
  ]
});

prisma.$on("warn", (event) => process.stdout.write(`${JSON.stringify({ level: "warn", source: "prisma", message: event.message })}\n`));
prisma.$on("error", (event) => process.stderr.write(`${JSON.stringify({ level: "error", source: "prisma", message: event.message })}\n`));
