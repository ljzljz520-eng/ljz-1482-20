# 交付结果

已完成创作工作台全栈部署自检方案：

- React/Vite 前端保留 Vercel 与 Trae 预览配置，支持 `/api` 代理和 `VITE_API_BASE`。
- Fastify + Prisma + PostgreSQL 提供真实鉴权、项目、素材、回调和导出 API。
- MinIO/S3 预签名上传与短期下载授权，后端按租户生成授权。
- Redis/BullMQ + 独立 worker 执行 ffmpeg 转码和 ZIP 导出。
- 自检覆盖版本、配置、CORS、鉴权、迁移、对象存储、回调幂等、队列消费和重启续接。
- 密钥只返回 ready/missing，不返回密钥值；状态按租户隔离。
- 缺配置或后端不可用时明确失败，不启用 Mock 假数据。
- 提供 Docker Compose、真实贯通测试脚本和不改源码的部署/回退说明书。

构建验证：后端 `npm run build`、前端 `npm run build` 均已通过。当前沙箱未提供 Docker/Postgres/Redis/MinIO，因此容器编排的实际运行需在验收环境执行 `docker compose up --build`，随后运行 `./scripts/smoke-test.sh` 或点击页面“一键贯通测试”。
