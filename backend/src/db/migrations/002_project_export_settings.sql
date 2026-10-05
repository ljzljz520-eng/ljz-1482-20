-- 后续版本的增量迁移：验收时可故意停在 001 验证“迁移不完整”检测
ALTER TABLE projects ADD COLUMN IF NOT EXISTS export_format TEXT NOT NULL DEFAULT 'zip'
  CHECK (export_format IN ('zip'));
ALTER TABLE projects ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb;
