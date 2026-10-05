import { Pool } from "pg";

export interface UserRow {
  id: string;
  tenantId: string;
  username: string;
  displayName: string;
  role: "admin" | "member";
}

function mapUser(row: Record<string, unknown>): UserRow {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    username: row.username as string,
    displayName: row.display_name as string,
    role: row.role as "admin" | "member",
  };
}

export class UserRepo {
  constructor(private pool: Pool) {}

  async findByUsername(username: string): Promise<(UserRow & { passwordHash: string }) | null> {
    const { rows } = await this.pool.query(
      "SELECT * FROM users WHERE lower(username) = lower($1)",
      [username]
    );
    if (!rows[0]) return null;
    return { ...mapUser(rows[0]), passwordHash: rows[0].password_hash as string };
  }

  async findById(id: string): Promise<UserRow | null> {
    const { rows } = await this.pool.query(
      "SELECT id, tenant_id, username, display_name, role FROM users WHERE id = $1",
      [id]
    );
    return rows[0] ? mapUser(rows[0]) : null;
  }
}

export interface ProjectRow {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  exportFormat: string;
  settings: Record<string, unknown>;
  createdAt: Date;
}

function mapProject(row: Record<string, unknown>): ProjectRow {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    name: row.name as string,
    description: (row.description as string) ?? "",
    exportFormat: (row.export_format as string) ?? "zip",
    settings: (row.settings as Record<string, unknown>) ?? {},
    createdAt: row.created_at as Date,
  };
}

export class ProjectRepo {
  constructor(private pool: Pool) {}

  async create(tenantId: string, name: string, description: string, createdBy: string): Promise<ProjectRow> {
    const { rows } = await this.pool.query(
      `INSERT INTO projects (tenant_id, name, description, created_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [tenantId, name, description, createdBy]
    );
    return mapProject(rows[0]);
  }

  async list(tenantId: string): Promise<ProjectRow[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM projects WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 100",
      [tenantId]
    );
    return rows.map(mapProject);
  }

  async get(tenantId: string, id: string): Promise<ProjectRow | null> {
    const { rows } = await this.pool.query(
      "SELECT * FROM projects WHERE id = $1 AND tenant_id = $2",
      [id, tenantId]
    );
    return rows[0] ? mapProject(rows[0]) : null;
  }
}

export interface AssetRow {
  id: string;
  tenantId: string;
  projectId: string;
  filename: string;
  kind: string;
  sizeBytes: number;
  storageKey: string;
  storageBucket: string;
  checksum: string | null;
}

function mapAsset(row: Record<string, unknown>): AssetRow {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    projectId: row.project_id as string,
    filename: row.filename as string,
    kind: row.kind as string,
    sizeBytes: Number(row.size_bytes),
    storageKey: row.storage_key as string,
    storageBucket: row.storage_bucket as string,
    checksum: (row.checksum as string) ?? null,
  };
}

export class AssetRepo {
  constructor(private pool: Pool) {}

  async listForProject(tenantId: string, projectId: string): Promise<AssetRow[]> {
    const { rows } = await this.pool.query(
      `SELECT a.* FROM assets a
       JOIN projects p ON p.id = a.project_id
       WHERE a.project_id = $1 AND a.tenant_id = $2 AND p.tenant_id = $2
       ORDER BY a.uploaded_at`,
      [projectId, tenantId]
    );
    return rows.map(mapAsset);
  }

  async get(id: string, tenantId: string): Promise<AssetRow | null> {
    const { rows } = await this.pool.query(
      "SELECT * FROM assets WHERE id = $1 AND tenant_id = $2",
      [id, tenantId]
    );
    return rows[0] ? mapAsset(rows[0]) : null;
  }

  /**
   * 回调落库：依赖 upload_callbacks 唯一索引实现幂等。
   * 重复回调返回既有 asset，且 duplicate=true。
   */
  async createFromCallback(input: {
    tenantId: string;
    projectId: string;
    filename: string;
    kind: string;
    sizeBytes: number;
    storageKey: string;
    bucket: string;
    checksum: string;
    idempotencyKey: string;
    payloadHash: string;
  }): Promise<{ asset: AssetRow; duplicate: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existingCb = await client.query(
        `SELECT asset_id FROM upload_callbacks
         WHERE tenant_id = $1 AND idempotency_key = $2 FOR UPDATE`,
        [input.tenantId, input.idempotencyKey]
      );
      if (existingCb.rows[0]) {
        const { rows } = await client.query(
          "SELECT * FROM assets WHERE id = $1 AND tenant_id = $2",
          [existingCb.rows[0].asset_id, input.tenantId]
        );
        await client.query("COMMIT");
        return { asset: mapAsset(rows[0]), duplicate: true };
      }
      const inserted = await client.query(
        `INSERT INTO assets
           (tenant_id, project_id, filename, kind, size_bytes, storage_key, storage_bucket, checksum)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (tenant_id, storage_bucket, storage_key) DO NOTHING
         RETURNING *`,
        [
          input.tenantId,
          input.projectId,
          input.filename,
          input.kind,
          input.sizeBytes,
          input.storageKey,
          input.bucket,
          input.checksum,
        ]
      );
      const assetRow = inserted.rows[0] ?? (
        await client.query(
          "SELECT * FROM assets WHERE tenant_id = $1 AND storage_bucket = $2 AND storage_key = $3",
          [input.tenantId, input.bucket, input.storageKey]
        )
      ).rows[0];
      await client.query(
        `INSERT INTO upload_callbacks (tenant_id, idempotency_key, asset_id, payload_hash)
         VALUES ($1,$2,$3,$4)`,
        [input.tenantId, input.idempotencyKey, assetRow.id, input.payloadHash]
      );
      await client.query("COMMIT");
      return { asset: mapAsset(assetRow), duplicate: false };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}
