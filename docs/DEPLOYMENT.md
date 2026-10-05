# 部署手册（不改源码的环境配置）

本手册描述如何在**不修改任何源码**的前提下完成配置、部署、验收与回退。
前端保留两种接入方式：

1. **Trae / 本地 Vite 预览**：Vite dev/preview server 通过 `VITE_API_PROXY_TARGET` 代理 `/api`。
2. **Vercel 静态托管**：构建时注入 `VITE_API_BASE` 指向后端绝对地址，由 `vercel.json` 做 SPA 回退。

---

## 1. 架构与边界

| 组件 | 说明 | 持久化 |
| --- | --- | --- |
| frontend | React 18 + Vite 5 构建的静态产物（Nginx / Vercel） | 无 |
| backend (API) | Fastify，提供真实 API、鉴权、上传回调、自检与任务入队 | 仅状态在 DB/对象存储 |
| worker | 独立长任务执行器进程，消费持久队列执行转码导出 | 仅状态在 DB/对象存储 |
| db | PostgreSQL 16，业务数据 + 任务队列 + worker 心跳 | Docker Volume |
| minio | S3 兼容对象存储，素材与导出产物 | Docker Volume |

关键原则：

- **短操作**（建项目、上传素材、回调登记）在 HTTP 请求内完成，立即得到成功/失败。
- **长操作**（转码导出）只在 API 内完成「入队」，由 worker 异步执行。网页关闭、API 重启、worker 换版都不影响任务。
- **禁止假数据**：任一依赖不可用时，接口返回明确 `code`/`reason`，前端原样展示不可用原因。

---

## 2. 环境变量清单（只改环境，不改代码）

### 2.1 后端 `backend/.env`（或部署平台环境变量）

| 变量 | 必需 | 说明 |
| --- | --- | --- |
| `APP_ENV` | 是 | `preview` / `production` / `test`，决定默认桶名与隔离标识 |
| `PORT` | 否 | 默认 8000 |
| `API_VERSION` / `MIN_CLIENT_VERSION` / `BUILD_SHA` | 是 | 版本协商与自检展示 |
| `JWT_SECRET` | 是 | JWT 签名密钥；生产用 `openssl rand -hex 32`，自检只显示是否就绪 |
| `PUBLIC_BASE_URL` | 是 | 浏览器可访问的 API 绝对地址，用于回调/下载授权提示与探针 |
| `CORS_ORIGINS` | 是 | 浏览器来源**白名单**（逗号分隔），不在列表的 Origin 被 403 拒绝 |
| `DATABASE_URL` | 是 | PostgreSQL 连接串；预览与正式必须是不同实例或不同库 |
| `AUTO_MIGRATE` | 否 | `true` 时 API 启动自动迁移；`false` 时需手动 `npm run migrate` |
| `S3_ENDPOINT` / `S3_INTERNAL_ENDPOINT` / `S3_PORT` / `S3_USE_SSL` | 是 | 服务端对象存储地址 |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | 是 | 对象存储凭证，**永不下发浏览器** |
| `S3_BUCKET` | 是 | 桶名；预览 `workbench-preview`、正式 `workbench-prod`，物理隔离 |
| `S3_PUBLIC_ENDPOINT` / `S3_PUBLIC_PORT` | 是 | 浏览器访问对象存储的对外地址（预签名 URL 用） |
| `S3_PRESIGN_TTL_SECONDS` | 否 | 下载授权有效期，默认 300 秒 |
| `QUEUE_LEASE_MS` / `QUEUE_HEARTBEAT_MS` / `QUEUE_MAX_ATTEMPTS` | 否 | 租约、心跳、重试上限 |
| `WORKER_NAME` / `WORKER_HEALTH_PORT` | 否 | worker 标识与存活探针端口 |
| `EXPORT_DELAY_MS` | 否 | 演练用：人为拖长导出，验证换版在途任务接管 |

示例见 `backend/.env.example`。所有变量只在部署平台 / `.env` 中设置，代码不内置任何真实密钥。

### 2.2 前端（构建期变量）

| 变量 | Trae/本地预览 | Vercel |
| --- | --- | --- |
| `VITE_API_BASE` | 留空（走代理） | `https://<后端域名>` |
| `VITE_API_PROXY_TARGET` | `http://localhost:8000`（或局域网后端） | 不使用 |

Trae：复制 `frontend/.env.trae.example` 为 `frontend/.env.local`。
Vercel：在 **Project Settings → Environment Variables** 中配置 `VITE_API_BASE`（示例见 `.env.vercel.example`），并在后端把 Vercel 域名加入 `CORS_ORIGINS`。

### 2.3 预览与正式隔离（强制）

| 维度 | 预览 | 正式 |
| --- | --- | --- |
| 数据库 | `workbench_preview` | `workbench_prod`（不同实例/库） |
| 对象存储桶 | `workbench-preview` | `workbench-prod` |
| `PUBLIC_BASE_URL` / 回调地址 | 预览 API 域名 | 正式 API 域名 |
| 下载授权预签名域名 | 预览对外 endpoint | 正式对外 endpoint |
| `CORS_ORIGINS` | 仅预览前端域名 | 仅正式前端域名 |

预签名 URL 带有 endpoint 与短时效，天然不可跨环境复用；后端在签发下载前还会再次校验任务归属租户。

---

## 3. 启动方式

### 3.1 一键 Docker Compose（本地/预览全链路）

```bash
cp backend/.env.example backend/.env        # 按需修改，尤其 JWT_SECRET / S3_SECRET_KEY
docker compose up --build -d
docker compose logs -f backend worker
```

服务地址：

- 前端（Nginx）：http://localhost:3000
- API：http://localhost:8000/api/health/ready
- MinIO Console：http://localhost:9001 （本地凭据见 compose）
- PostgreSQL：localhost:5432

首次启动 API 自动迁移；`seed` 服务幂等创建演示租户与账号。

### 3.2 Vercel 前端 + 独立后端

1. 后端按第 2 节配置环境变量后部署（容器或 Node 平台均可），确保 `/api/health/ready` 返回 200。
2. Vercel 导入 `frontend/`（根目录构建，Build Command `npm run build`，Output `dist`）。
3. 配置 `VITE_API_BASE`，后端配置 `CORS_ORIGINS=https://<project>.vercel.app`。
4. 打开前端 → `/self-check`，确认 CORS、版本、鉴权、回调、队列全部通过。

### 3.3 Trae 内置预览

```bash
cd frontend
cp .env.trae.example .env.local   # VITE_API_PROXY_TARGET 指向后端
npm install
npm run dev                       # Trae 会在 5173 端口预览，/api 自动代理
```

---

## 4. 部署自检如何读结果

页面 `/self-check`（登录后）展示：

- **版本兼容**：前端 `X-Client-Version` 与 `API_VERSION` / `MIN_CLIENT_VERSION` 协商。
- **敏感配置就绪**：只出现 `true/false` 与变量名，不出现任何值；缺失时给出变量名与补齐位置。
- **关系数据库 & 迁移**：连通延迟 + 是否存在未执行迁移（列出待执行版本号）。
- **对象存储**：在当前环境桶内真实写入并读回探针对象。
- **队列消费**：worker 心跳年龄、积压数量；「深度贯通探针」会真实投递 probe 任务等待消费。
- **鉴权**：携带无效令牌访问受保护接口，必须被 401 拒绝。
- **上传回调**：真实写入对象 + 两次相同 `X-Idempotency-Key` 回调，验证重复回调不产生第二条素材。

每个失败项都附**不改代码的修复指引**。自检结果严格限定在当前租户，不返回其他租户的项目、任务、存储运维信息。

---

## 5. 持久队列与进程重启/换版续接机制

1. API 只把任务写入 `jobs` 表（`queued`），不做实际转码。
2. worker 用 `FOR UPDATE SKIP LOCKED` 原子认领任务，写入 `leased_by`、`leased_until`、`heartbeat_at`。
3. 执行期间每 `QUEUE_HEARTBEAT_MS` 续租一次；任务完成写 `succeeded` + 结果，失败按 `max_attempts` 指数退避重试，超限标记 `dead`（不静默丢失）。
4. **在途任务接管**：worker 被 kill、容器换版、节点宕机后，心跳停止、租约到期；任意存活 worker 的下一轮 `claim` 会把过期 `running` 任务重新认领（`attempts+1`）并重新执行。导出按「项目当前素材」重算，具备幂等性。
5. **多实例安全**：行锁保证同一任务不会被两个 worker 同时执行；多 worker 横向扩容无需额外组件。
6. 因此任务续接**完全不依赖网页或短请求在线**；浏览器轮询只是观察手段。

部署换版演练：设置 `EXPORT_DELAY_MS=45000` 后发起导出，在任务执行中 `docker compose restart worker`（或滚动更新），新 worker 会在租约（默认 30s）到期后接管，任务最终 `succeeded`，前端可看到 `attempts` 增加。

---

## 6. 回退步骤（不改源码）

1. **前端回退**：Vercel 在 Deployments 中对目标版本点 **Promote to Production**；Compose 使用旧镜像 tag：`FRONTEND_TAG=<旧版本> docker compose up -d frontend`。
2. **后端/worker 回退**：将镜像 tag 改回旧版本重启即可；在途任务由第 5 节租约机制自动接管，无需人工干预。
3. **迁移回退**：迁移文件仅做**加法式**变更（新增可空列/新表），旧版本二进制可兼容新 schema。如必须回到更早 schema，由 DBA 用备份恢复（不提供自动 down，避免破坏性回退）。
   - 升级前备份：`docker compose exec db pg_dump -U workbench workbench_preview > backup-$(date +%F).sql`。
4. **配置回退**：在部署平台把环境变量改回上一版并重启；`/api/health/ready` 恢复 200 即完成。
5. **预览/正式串扰应急**：立即检查 `APP_ENV`、`DATABASE_URL`、`S3_BUCKET` 三项，隔离错误的实例下线；桶与库物理隔离，串扰不会产生跨环境数据写入。

---

## 7. 常见故障对照

| 现象 | 自检项 | 处理（不改代码） |
| --- | --- | --- |
| 环境变量遗漏 | 敏感配置就绪 fail | 按提示的变量名在部署平台补齐后重启 |
| 浏览器跨域被拒绝（403 CORS_BLOCKED） | 控制台/自检 | 把页面 Origin 精确加入 `CORS_ORIGINS`（不带路径，含端口） |
| 数据库迁移不完整 | 关系数据库 & 迁移 fail | `docker compose run --rm backend node dist/bin/migrate.js up` |
| 上传回调重复产生重复素材 | 上传回调 fail | 确认使用 001 迁移后的库（存在 `uq_upload_callback_key` 唯一索引） |
| 导出一直 queued | 队列消费 fail | 检查 worker 是否运行、其 `DATABASE_URL` 是否与 API 同库、迁移是否完整 |
| worker 重启后任务卡住 | 队列消费 warn | 等待一个租约周期；仍异常则核对时钟与 `QUEUE_LEASE_MS` |
| 下载链接打不开/过期 | 导出下载 410/403 | 重新申请；检查 `S3_PUBLIC_ENDPOINT` 与桶环境是否一致 |
