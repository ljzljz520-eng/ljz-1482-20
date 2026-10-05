-- 创作工作台核心表：多租户、项目、素材、持久队列任务、上传回调幂等
CREATE TABLE tenants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_tenant ON users(tenant_id);

CREATE TABLE projects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  description TEXT NOT NULL DEFAULT '',
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_projects_tenant ON projects(tenant_id, created_at DESC);

CREATE TABLE assets (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  filename       TEXT NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'file' CHECK (kind IN ('image','video','audio','text','file')),
  size_bytes     BIGINT NOT NULL DEFAULT 0,
  storage_key    TEXT NOT NULL,
  storage_bucket TEXT NOT NULL,
  checksum       TEXT,
  uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_assets_project ON assets(project_id);
CREATE UNIQUE INDEX uq_assets_storage ON assets(tenant_id, storage_bucket, storage_key);

-- 上传回调幂等：同一 (tenant, idempotency_key) 重复回调只落一次
CREATE TABLE upload_callbacks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  asset_id        UUID REFERENCES assets(id) ON DELETE CASCADE,
  payload_hash    TEXT NOT NULL,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_upload_callback_key
  ON upload_callbacks(tenant_id, idempotency_key);

-- 持久任务队列：任务状态完全落在关系数据库，进程重启可续接
CREATE TABLE jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('export','probe')),
  status        TEXT NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued','running','succeeded','failed','dead')),
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  result        JSONB,
  error         TEXT,
  attempts      INT NOT NULL DEFAULT 0,
  max_attempts  INT NOT NULL DEFAULT 3,
  run_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  leased_by     TEXT,
  leased_until  TIMESTAMPTZ,
  heartbeat_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ
);
CREATE INDEX idx_jobs_dispatch
  ON jobs(status, run_at)
  WHERE status IN ('queued','running');
CREATE INDEX idx_jobs_tenant ON jobs(tenant_id, created_at DESC);

-- worker 心跳：自检页消费延迟依据，重启后接管不依赖网页在线
CREATE TABLE worker_beats (
  id           BIGSERIAL PRIMARY KEY,
  worker_name  TEXT NOT NULL,
  beat_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_worker_beats_time ON worker_beats(beat_at DESC);
