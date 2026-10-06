import bcrypt from "bcryptjs";
import { prisma } from "./lib/prisma.js";
import { logger } from "./lib/logger.js";

async function main() {
  const tenantSlug = process.env.SEED_TENANT_SLUG || "demo-studio";
  const email = (process.env.SEED_USER_EMAIL || "admin@example.com").toLowerCase();
  const password = process.env.SEED_USER_PASSWORD || "Workbench@2026";
  const tenantName = process.env.SEED_TENANT_NAME || "演示创作工作室";

  const tenant = await prisma.tenant.upsert({
    where: { slug: tenantSlug },
    update: { name: tenantName },
    create: { slug: tenantSlug, name: tenantName }
  });
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.upsert({
    where: { email },
    update: { passwordHash, tenantId: tenant.id, role: "admin", name: "工作台管理员" },
    create: { tenantId: tenant.id, email, passwordHash, role: "admin", name: "工作台管理员" }
  });
  logger.info("Seed completed", { tenant: tenantSlug, email, passwordReady: true });
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ level: "error", message: "Seed failed", error: error.message })}\n`);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
