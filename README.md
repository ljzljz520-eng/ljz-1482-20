# 创作工作台 · 部署自检与持久任务系统

一个**真实可部署**的创作工作台：前端保留 Vite 在 Vercel 与 Trae 预览的配置方式，后端提供真实 API、PostgreSQL 关系数据库（同时承担持久任务队列）、S3 兼容对象存储与独立长任务执行器。内置部署自检页，覆盖版本兼容、鉴权、上传回调（含重复回调）与队列消费；敏感配置仅展示是否就绪，**密钥值永不进入浏览器**。

## 🛠 技术栈

- **Frontend**: React 18 + TypeScript + Vite 5 + Tailwind CSS + Zustand + React Router（支持 Trae 本地预览与 Vercel 静态部署）
- **Backend**: Node.js 20 + Fastify 4 + JWT（Bearer）+ `@fastify/cors` 白名单 + `@fastify/multipart`
- **Database**: PostgreSQL 16（业务数据、持久化任务队列、worker 心跳、上传回调幂等表）
- **Object Storage**: MinIO（S3 兼容；双 endpoint：容器内网读写 / 对外预签名下载）
- **Long-task Worker**: 独立 Node 进程，`FOR UPDATE SKIP LOCKED` 认领 + 租约心跳 + 崩溃/换版接管 + 指数退避重试

## 🚀 启动指南（一键）

1. 确保 Docker Desktop / Docker Engine 已启动。
2. 根目录执行：

```bash
cp .env.example .env          # 生产请务必修改 JWT_SECRET / S3_SECRET_KEY
docker compose up --build -d
docker compose logs -f backend worker
```

3. 访问：
   - 前端：http://localhost:3000
   - API 就绪探针：http://localhost:8000/api/health/ready
   - MinIO 控制台：http://localhost:9001

> 前端 Vite 构建方式被完整保留：Trae/本地 `npm run dev` 走 `VITE_API_PROXY_TARGET` 代理；Vercel 构建时设置 `VITE_API_BASE`。详见 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)。

## 🔗 服务地址

| 服务 | 地址 |
| --- | --- |
| Frontend (Nginx/Vercel) | http://localhost:3000 |
| Backend API | http://localhost:8000 |
| 部署自检页 | http://localhost:3000/self-check （登录后） |
| MinIO Console | http://localhost:9001 |
| PostgreSQL | localhost:5432 |

## 🧪 测试账号（seed 幂等创建）

| 租户 | 账号 | 密码 | 用途 |
| --- | --- | --- | --- |
| 演示工作室 | `admin` | `123456` | 常规贯通测试 |
| 第二租户 | `admin2` | `123456` | 验证跨租户隔离（互不可见） |

## 📋 验收（六个场景，全部真实执行）

```bash
./scripts/acceptance.sh docker        # 自动起 test 专用库/桶并跑全部验收
# 或对已运行的栈：
API_BASE=http://localhost:8000 ./scripts/acceptance.sh http
```

覆盖：

1. **环境变量遗漏** —— worker 拒绝启动并指出变量名；ready 探针 503 列明原因，不允许无提示假成功。
2. **跨域拒绝** —— 非白名单 Origin 返回 403 `CORS_BLOCKED`。
3. **数据库迁移不完整** —— scratch 库只执行 001，自检/`migrate status` 必须显式报 pending。
4. **贯通测试** —— 真实创建项目 → 上传小素材 → 持久队列转码导出 zip → 300s 预签名下载。
5. **回调重复** —— 相同 `X-Idempotency-Key` 两次回调只产生一条素材（数据库唯一索引保证）。
6. **部署换版在途任务** —— 导出执行中重启 worker，租约到期后由新 worker 接管，任务最终成功。
7. 附加：多租户隔离（跨租户读任务 404）与自检响应不含密钥值。

## 🔁 短操作 vs 长任务

| 类型 | 例子 | 执行位置 | 依赖网页在线？ | 失败行为 |
| --- | --- | --- | --- | --- |
| 请求内短操作 | 登录、建项目、上传小素材、回调登记 | API 请求内 | 是（普通请求语义） | 立即返回错误原因 |
| 持久队列长任务 | 转码导出 | 独立 worker | **否**：状态只在 DB + 对象存储；网页/API 重启均不影响 | 租约接管 + 退避重试，超限 `dead` 可观测 |

## 🔐 安全与隔离要点

- 自检/业务接口全部 JWT 鉴权且按 `tenant_id` 过滤；状态页不展示任何其他租户的运维信息。
- 密钥类环境变量在自检中只返回布尔（如 `S3_SECRET_KEY: false`），响应体不含值。
- 预览（`workbench-preview`）与正式（`workbench-prod`）使用独立数据库与桶、独立回调/预签名域名，下载授权短 TTL 且绑定环境 endpoint。
- 下载签发前再次校验任务归属租户与对象是否存在。

## 🧰 无 Docker 本地验证（开发机）

后端内置三层自动化校验（CI/无 Docker 环境可用）：

```bash
cd backend
npm install
npm run build
npm run test:logic   # 版本协商、环境变量校验、密钥布尔化
npm run test:db      # PGlite：迁移幂等、回调唯一索引、租约接管 SQL 语义
MINIO_BIN=/path/to/minio npm run test:local  # embedded-postgres+真实 MinIO 全链路 27 项断言
```

`test:local` 已实测覆盖：CORS 拒绝、401、自检不含密钥、真实建项目、上传+重复回调幂等、队列导出 zip、预签名下载、跨租户 404、强杀 worker 后在途任务接管成功。

## 📚 文档

- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) —— 不改源码的环境配置、Trae/Vercel 接入、回退步骤、故障对照表
- [`backend/.env.example`](backend/.env.example) / [`.env.example`](.env.example) —— 环境变量样例
