# 创作工作台（Creator Workbench）

面向素材创作、上传与转码导出的全栈示例，重点提供生产部署自检：真实 API、Postgres 关系数据库、S3 兼容对象存储、Redis 持久队列和独立长任务 worker 全部可连接、可验证；前端保留 Vite 在 Vercel 与 Trae 预览中的配置方式。

## 技术栈

- Frontend: React 18 + TypeScript + Vite 5 + Tailwind CSS + Zustand + Axios + Lucide
- Backend: Node.js 20 + Fastify 4 + TypeScript + Prisma
- Database: PostgreSQL 16
- Queue: Redis 7 + BullMQ，独立 Node worker
- Object Storage: MinIO / S3 兼容 API，预签名上传和短时下载授权
- Transcode: ffmpeg（音频/视频转 MP3，图片转 JPG）+ ZIP manifest 导出
- Runtime: Docker Compose / Nginx

## 启动指南

1. 确保 Docker 与 Docker Compose 已启动。
2. 在仓库根目录执行：

```bash
docker compose up --build
```

3. 等待数据库迁移和健康检查完成。
4. 打开 http://localhost:3000 并登录。

> 本地默认密钥仅用于开发。正式环境请运行 `./scripts/make-secrets.sh` 生成并写入部署平台的 Secret，不要提交 `.env`。

## 服务地址

- Frontend: http://localhost:3000
- API Health: http://localhost:3001/api/health
- MinIO Console: http://localhost:9001
- PostgreSQL: localhost:5432
- Redis: localhost:6379

## 测试账号

- Admin: `admin@example.com / Workbench@2026`

## 核心能力

1. **部署自检页**：版本兼容、环境变量就绪、CORS、JWT 鉴权、数据库和 Prisma 迁移、对象存储读写/预签名、上传回调、队列消费、worker 重启续接。
2. **敏感配置保护**：浏览器只看到 `ready/missing`，不会收到 JWT、数据库密码、对象存储 Secret。
3. **请求内短操作**：登录、项目创建、申请上传 URL、查询状态在 HTTP 请求内完成。
4. **持久队列长任务**：导出任务先写 Postgres 再投递 BullMQ；独立 worker 执行 ffmpeg 与 ZIP 打包，API 请求和网页都不需要长期在线。
5. **重启与换版续接**：worker 启动及定时扫描将 `queued` 和心跳超时的 `running` 任务重新认领；BullMQ stalled job 自动重试。
6. **上传回调幂等**：`WebhookEvent.externalEventId` 唯一约束去重，签名失败不更新素材。
7. **租户隔离**：项目、素材、导出、回调和预签名下载均按 JWT 中的 `tenantId` 限定。
8. **明确失败，不使用假数据**：后端缺失、环境变量遗漏、CORS 拒绝、迁移不完整、worker 停止时，页面显示真实错误和修复方向。

## Vercel 与 Trae 预览

### Vercel

- Project Directory：`frontend`
- Framework：Vite
- Build：`npm run build`
- Output：`dist`
- Build Env：`VITE_API_BASE=https://<your-api-host>/api`

后端密钥不能配置成 `VITE_*`。完整说明见 `frontend/vercel.json`、`frontend/.vercel.example.json` 和 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)。

### Trae / Vite dev preview

```bash
cd frontend
npm install
VITE_DEV_PROXY_TARGET=http://localhost:3001 npm run dev -- --host 0.0.0.0
```

`vite.config.ts` 保留 `/api -> VITE_DEV_PROXY_TARGET` 代理；样例见 `frontend/.trae.example.json`。

## 贯通测试

页面点击“一键贯通测试”会：

1. 登录真实 API。
2. 在 Postgres 创建项目。
3. 在浏览器生成 1 秒 WAV 小素材。
4. 获取预签名 URL 并上传到 MinIO。
5. 发送签名上传回调，并验证重复回调幂等。
6. 投递导出到 Redis 队列。
7. worker 使用 ffmpeg 转码并打包 ZIP 到对象存储。
8. 使用短时授权 URL 下载导出结果。

命令行版本：

```bash
./scripts/smoke-test.sh
```

需要宿主机具备 `curl`、`jq`、`ffmpeg`、`unzip`；容器内的贯通测试可直接通过前端完成。

## 环境隔离

Preview 与 Production 必须使用独立：

- Postgres / `DATABASE_URL`
- Redis 实例或 `QUEUE_PREFIX`
- Object Storage bucket / `S3_BUCKET`
- `CORS_ORIGIN` 和 `CALLBACK_BASE_URL`
- `JWT_SECRET`、`CALLBACK_SECRET`、对象存储凭证
- 下载授权域名与有效期

示例：`.env.preview.example`、`.env.production.example`。

## 常见问题

### 自检提示环境变量遗漏

查看 `/api/health` 返回的变量名，在部署平台或 `.env` 中补齐后重启 backend 与 worker。

### 浏览器请求被 CORS 拒绝

把当前页面 Origin（不含路径，含端口）加入 `CORS_ORIGIN`，多个用英文逗号分隔。

### 对象存储上传失败

确认浏览器能访问 `S3_PUBLIC_ENDPOINT`，后端能访问内网 `S3_ENDPOINT`，桶 CORS 允许当前 Origin 的 `PUT/GET/HEAD`。

### 队列消费失败

检查 Redis 地址和 worker 日志：`docker compose logs -f worker`。任务状态仍保留在 Postgres，worker 恢复后会继续，不会因为网页关闭而丢失。

### 数据库迁移不完整

后端容器启动会执行 `prisma migrate deploy`。若数据库被回滚到旧快照，请先恢复到兼容版本并让自检 migration 项通过，再启动 worker。

## 文档

- 部署、环境变量、故障注入、验收和回退：[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)
- 命令行贯通测试：[`scripts/smoke-test.sh`](scripts/smoke-test.sh)
