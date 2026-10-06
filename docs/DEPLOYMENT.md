# 部署、自检与回退说明书

本项目的所有部署参数均通过环境变量注入，无需改源码。请为 preview 与 production 分别准备数据库、Redis、对象存储桶、回调域名、CORS 域名、队列前缀和密钥。

## 1. 必需环境变量

| 变量 | 用途 | 是否敏感 |
|---|---|---|
| `APP_ENV` | `preview` / `production` / `development` | 否 |
| `API_VERSION`、`CONTRACT_VERSION`、`MIN_CLIENT_VERSION` | API 与前端契约兼容检查 | 否 |
| `DATABASE_URL` | Postgres 连接串，Prisma 迁移使用 | 是 |
| `REDIS_URL` | BullMQ 持久队列连接串 | 是 |
| `S3_ENDPOINT` | 后端内网访问对象存储地址 | 否 |
| `S3_PUBLIC_ENDPOINT` | 浏览器访问预签名 URL 的外部地址 | 否 |
| `S3_BUCKET` | 对象存储桶 | 否 |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | 对象存储凭证 | 是 |
| `JWT_SECRET` | 登录 JWT 签名密钥 | 是 |
| `CALLBACK_SECRET` | 上传回调及预签名确认令牌签名密钥 | 是 |
| `CORS_ORIGIN` | 逗号分隔的浏览器 Origin 白名单 | 否 |
| `CALLBACK_BASE_URL` | 对象存储回调目标环境地址 | 否 |
| `QUEUE_PREFIX` | 队列命名空间，预览和生产必须不同 | 否 |

自检接口只返回 `ready` 或 `missing`，不会返回任何密钥值。

## 2. Docker Compose（本地或单机）

```bash
cp .env.example .env
./scripts/make-secrets.sh
# 将生成的密码同步到 .env 的 DATABASE_URL、POSTGRES_PASSWORD 与 S3 凭证
docker compose up --build -d
```

启动顺序：Postgres/Redis/MinIO 健康检查通过后，后端执行 `prisma migrate deploy`、seed，再提供 API；worker 独立运行，前端 Nginx 代理 `/api` 到 `backend:3001`。

访问：

- 前端：http://localhost:3000
- API 健康检查：http://localhost:3001/api/health
- MinIO Console：http://localhost:9001
- 默认账号：`admin@example.com / Workbench@2026`

## 3. Vercel 前端配置

保留 Vite 的标准构建方式：

- Root / Project Directory：`frontend`
- Framework：Vite
- Build Command：`npm run build`
- Output Directory：`dist`
- Build Environment：`VITE_API_BASE=https://<preview-api-host>/api`

不要把 `JWT_SECRET`、`S3_SECRET_ACCESS_KEY` 等后端密钥配置为 `VITE_*`，任何 `VITE_*` 都可能进入浏览器包。Vercel 只部署静态前端，API、worker、数据库和对象存储必须独立部署。

## 4. Trae 预览配置

Trae 使用 Vite dev server：

```bash
cd frontend
npm install
VITE_DEV_PROXY_TARGET=http://localhost:3001 npm run dev -- --host 0.0.0.0
```

`vite.config.ts` 已将 `/api` 代理到 `VITE_DEV_PROXY_TARGET`，默认 `http://localhost:3001`。配置样例见 `frontend/.trae.example.json`。若 Trae 域名为 HTTPS，而本地 API 为 HTTP，浏览器可能阻止混合内容；请通过平台隧道或同源 HTTPS API 解决。

## 5. 预览与生产隔离

至少做到：

1. Postgres 数据库和迁移状态独立，不共用 `DATABASE_URL`。
2. Redis 实例或 `QUEUE_PREFIX` 独立，避免生产 worker 消费预览导出。
3. S3/MinIO bucket 独立，对象路径以 `tenants/<tenantId>/...` 隔离。
4. `CORS_ORIGIN` 与 `CALLBACK_BASE_URL` 分别指向当前环境域名。
5. 预签名下载 URL 短期有效（默认 600 秒），服务端按租户校验 `ExportJob` 后才生成。
6. `JWT_SECRET`、`CALLBACK_SECRET`、对象存储密钥分开轮换。

## 6. 验收场景与预期

| 场景 | 操作 | 预期 |
|---|---|---|
| 环境变量遗漏 | 删除或留空任一必需变量 | `/api/health` 返回 503 和缺失项名称；受保护接口不可用，不出现假数据 |
| 跨域拒绝 | 从未配置 Origin 调用 API | 403 `CORS_REJECTED`，自检显示修复方式 |
| 迁移不完整 | 回滚迁移或空库启动 | 自检数据库项失败并列出缺失 migration |
| 回调重复 | 用相同 `eventId` 重放回调 | 第二次返回 `duplicate=true`，素材不重复处理 |
| 部署换版在途任务 | 导出运行中 `docker compose restart worker` | worker 重启后恢复超时锁并继续/重试；网页关闭也不影响 |
| 队列消费者停止 | 停止 worker | 自检 `queueConsumer` 超时失败；任务保持 queued/running |
| 对象存储不可达 | 错误 endpoint/凭证 | 自检和上传明确失败，不降级到本地文件模拟 |

## 7. 真实贯通测试

先安装宿主机工具：`curl`、`jq`、`ffmpeg`、`unzip`。然后：

```bash
./scripts/smoke-test.sh
# 或指定环境
BASE_URL=https://preview-api.example.com/api SMOKE_EMAIL=you@example.com SMOKE_PASSWORD=... ./scripts/smoke-test.sh
```

脚本会登录、创建项目、生成 1 秒 WAV、申请预签名上传、PUT 到对象存储、确认回调并重放一次、投递导出、轮询独立 worker、下载短时 ZIP 并校验其中包含 `asset-1.mp3` 与 `manifest.json`。

也可在页面点击“一键贯通测试”。该操作产生真实数据库行、对象和导出文件。

## 8. 回退步骤（不改源码）

### 8.1 前端回退

1. 在 Vercel Deployments 中选择上一版，点击 Promote to Production / Rollback。
2. Trae 可切回上一分支或上一预览构建。
3. 若新前端契约版本高于旧后端，临时在托管平台将 `MIN_CLIENT_VERSION` 调到兼容的旧版本；更推荐回退前端。

### 8.2 后端或 worker 回退

1. 部署旧版后端镜像，不先执行破坏性迁移。
2. worker 可独立回退到旧镜像；队列和 Postgres 中的 queued 任务会继续保留。
3. 新版本写入但旧版本无法处理的任务，将保持 queued，不会在网页上假成功；排查后再恢复新版本。

### 8.3 数据库回退

1. 首先暂停 worker：`docker compose stop worker`，停止新任务消费。
2. 从变更前的 Postgres 快照恢复到独立数据库实例。
3. 将 `DATABASE_URL` 指向回退后的实例，重启后端。
4. 检查 `/system/self-check` 的 migration 项通过后再启动 worker。
5. 失败导出可通过重新提交或由恢复机制按旧任务状态处理；不要直接删除回调幂等表。

### 8.4 配置回退

- 在部署平台恢复上一版环境变量；密钥轮换后，旧 JWT 会失效，用户重新登录即可。
- CORS 配错时先把准确 Origin 加入 `CORS_ORIGIN`，不要为了临时通过使用 `*` 加凭证或关闭鉴权。
- 对象存储地址变更时，同步更新内网 `S3_ENDPOINT` 和浏览器用 `S3_PUBLIC_ENDPOINT`。

## 9. 多租户安全边界

- 项目、素材、导出查询均强制 `tenantId = 当前 JWT.tenantId`。
- 回调必须携带租户并通过签名；找不到当前租户素材时不会更新对象。
- 自检只汇总当前租户的在途任务数量和当前请求的认证信息，不返回用户列表、其他租户项目、队列详情或密钥。
- 错误信息仅包含必要的连接失败原因；生产建议将底层错误写入服务端日志而非扩大到响应内容。
