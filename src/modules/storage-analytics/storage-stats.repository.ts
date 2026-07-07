import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  CleanupRecommendation,
  CompanyStorageStat,
  DatabaseStat,
  ImageStats,
  LogStat,
  TableStat,
} from './interfaces/storage-analytics.interfaces';

/**
 * Xom SQL'dan kelgan timestamptz — pg drayverida Date obyekti. String(...) ISO
 * bo'lmagan ko'rinish berib frontendda parseISO'ni sindiradi, shu sabab doim
 * toISOString() bilan normallashtiramiz.
 */
function toIso(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * PostgreSQL system cataloglari (pg_class, pg_stat_user_tables, pg_stat_database,
 * pg_stat_user_indexes) ustidan xom SQL so'rovlar. Barcha og'ir hisob-kitob
 * SQL darajasida bajariladi — Node tomonga faqat tayyor natija keladi.
 *
 * Diqqat: bu repository faqat o'qiydi (read-only), applikatsiya jadvallariga yozmaydi.
 */
@Injectable()
export class StorageStatsRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Saralash uchun ruxsat etilgan ustunlar (SQL injection oldini olish) */
  private static readonly TABLE_SORT_COLUMNS: Record<string, string> = {
    tableName: 'relname',
    liveRows: 'live_rows',
    deadTuples: 'dead_tuples',
    totalBytes: 'total_bytes',
    tableBytes: 'table_bytes',
    indexBytes: 'index_bytes',
    seqScan: 'seq_scan',
    idxScan: 'idx_scan',
  };

  /**
   * Barcha foydalanuvchi jadvallari statistikasi (pagination + search + sort SQL da).
   * pg_total_relation_size = jadval + indeks + toast; toast alohida reltoastrelid orqali.
   */
  async findTables(options: {
    search?: string;
    sortBy?: string;
    sortOrder?: 'ASC' | 'DESC';
    limit: number;
    offset: number;
  }): Promise<{ items: TableStat[]; total: number }> {
    const sortColumn =
      StorageStatsRepository.TABLE_SORT_COLUMNS[options.sortBy ?? 'totalBytes'] ?? 'total_bytes';
    const sortOrder = options.sortOrder === 'ASC' ? 'ASC' : 'DESC';
    const search = options.search ? `%${options.search}%` : null;

    const rows: Array<Record<string, string | null>> = await this.dataSource.query(
      `
      SELECT
        s.relname                                            AS "tableName",
        s.n_live_tup                                         AS live_rows,
        s.n_dead_tup                                         AS dead_tuples,
        pg_relation_size(c.oid)                              AS table_bytes,
        pg_indexes_size(c.oid)                               AS index_bytes,
        COALESCE(pg_total_relation_size(c.reltoastrelid), 0) AS toast_bytes,
        pg_total_relation_size(c.oid)                        AS total_bytes,
        s.seq_scan                                           AS seq_scan,
        s.idx_scan                                           AS idx_scan,
        s.last_vacuum, s.last_autovacuum, s.last_analyze, s.last_autoanalyze,
        s.n_mod_since_analyze                                AS mod_since_analyze,
        GREATEST(s.last_vacuum, s.last_autovacuum, s.last_analyze, s.last_autoanalyze) AS last_updated,
        COUNT(*) OVER()                                      AS full_count
      FROM pg_stat_user_tables s
      JOIN pg_class c ON c.oid = s.relid
      WHERE ($1::text IS NULL OR s.relname ILIKE $1)
      ORDER BY ${sortColumn} ${sortOrder}
      LIMIT $2 OFFSET $3
      `,
      [search, options.limit, options.offset],
    );

    const total = rows.length ? Number(rows[0].full_count) : 0;
    return { items: rows.map((r) => this.mapTableRow(r)), total };
  }

  /** Bitta jadval statistikasi (nomi bo'yicha) */
  async findTable(tableName: string): Promise<TableStat | null> {
    const { items } = await this.findTables({ search: tableName, limit: 1, offset: 0 });
    return items.find((t) => t.tableName === tableName) ?? null;
  }

  /** Eng katta N jadval — dashboard bar chart uchun */
  async topTables(limit: number): Promise<{ tableName: string; totalBytes: number }[]> {
    const rows: Array<{ tableName: string; total_bytes: string }> = await this.dataSource.query(
      `
      SELECT s.relname AS "tableName", pg_total_relation_size(c.oid) AS total_bytes
      FROM pg_stat_user_tables s
      JOIN pg_class c ON c.oid = s.relid
      ORDER BY total_bytes DESC
      LIMIT $1
      `,
      [limit],
    );
    return rows.map((r) => ({ tableName: r.tableName, totalBytes: Number(r.total_bytes) }));
  }

  /** Baza darajasidagi umumiy statistika (pg_stat_database + pg_database_size) */
  async databaseStat(storageLimitBytes: number): Promise<DatabaseStat> {
    const [row]: Array<Record<string, string | null>> = await this.dataSource.query(`
      SELECT
        current_database()                       AS db_name,
        pg_database_size(current_database())     AS db_size,
        d.numbackends, d.xact_commit, d.xact_rollback,
        d.blks_read, d.blks_hit, d.temp_files, d.temp_bytes, d.deadlocks,
        d.stats_reset,
        version()                                AS pg_version,
        (SELECT COUNT(*) FROM pg_stat_user_tables)              AS total_tables,
        (SELECT COALESCE(SUM(n_live_tup), 0) FROM pg_stat_user_tables) AS total_rows
      FROM pg_stat_database d
      WHERE d.datname = current_database()
    `);

    const dbSize = Number(row.db_size);
    const blksHit = Number(row.blks_hit);
    const blksRead = Number(row.blks_read);
    const hitRatio = blksHit + blksRead > 0 ? (blksHit / (blksHit + blksRead)) * 100 : 100;

    return {
      databaseName: String(row.db_name),
      databaseSizeBytes: dbSize,
      storageLimitBytes,
      usedPercent: storageLimitBytes > 0 ? (dbSize / storageLimitBytes) * 100 : 0,
      freeBytes: Math.max(0, storageLimitBytes - dbSize),
      totalTables: Number(row.total_tables),
      totalRows: Number(row.total_rows),
      numBackends: Number(row.numbackends),
      xactCommit: Number(row.xact_commit),
      xactRollback: Number(row.xact_rollback),
      cacheHitRatio: Math.round(hitRatio * 100) / 100,
      tempFiles: Number(row.temp_files),
      tempBytes: Number(row.temp_bytes),
      deadlocks: Number(row.deadlocks),
      statsReset: toIso(row.stats_reset),
      postgresVersion: String(row.pg_version),
    };
  }

  /**
   * Kompaniya kesimida foydalanish. Har jadval uchun qatorlar COUNT bilan sanaladi
   * (indekslangan companyId/employeeId ustunlar orqali), so'ng hajm taxmini:
   * kompaniya_qatorlari × (jadval_hajmi / jonli_qatorlar).
   *
   * Bitta CTE-so'rov: N+1 o'rniga barcha jadvallar bo'yicha bitta round-trip.
   */
  async companyUsage(): Promise<CompanyStorageStat[]> {
    const rows: Array<Record<string, string | null>> = await this.dataSource.query(`
      WITH table_sizes AS (
        SELECT s.relname,
               pg_total_relation_size(c.oid)::numeric / GREATEST(s.n_live_tup, 1) AS avg_row_bytes
        FROM pg_stat_user_tables s
        JOIN pg_class c ON c.oid = s.relid
      ),
      per_company AS (
        SELECT
          co.id                                   AS company_id,
          co.name                                 AS company_name,
          co.status::text                         AS status,
          (SELECT COUNT(*) FROM "users" u WHERE u."companyId" = co.id)      AS users_count,
          (SELECT COUNT(*) FROM "employees" e WHERE e."companyId" = co.id)  AS employees_count,
          (SELECT COUNT(*) FROM "branches" b WHERE b."companyId" = co.id)   AS branches_count,
          (SELECT COUNT(*) FROM "devices" d WHERE d."companyId" = co.id)    AS devices_count,
          (SELECT COUNT(*) FROM "attendance_events" ae
             JOIN "employees" e ON e.id = ae."employeeId"
             WHERE e."companyId" = co.id)                                   AS attendance_count,
          (SELECT COUNT(*) FROM "work_days" wd
             JOIN "employees" e ON e.id = wd."employeeId"
             WHERE e."companyId" = co.id)                                   AS workdays_count,
          (SELECT COUNT(*) FROM "face_embeddings" fe
             JOIN "employees" e ON e.id = fe."employeeId"
             WHERE e."companyId" = co.id)                                   AS embeddings_count,
          (SELECT COUNT(*) FROM "payroll_records" pr
             JOIN "employees" e ON e.id = pr."employeeId"
             WHERE e."companyId" = co.id)                                   AS payroll_count,
          (SELECT MAX(ae."timestamp") FROM "attendance_events" ae
             JOIN "employees" e ON e.id = ae."employeeId"
             WHERE e."companyId" = co.id)                                   AS last_activity
        FROM "companies" co
      )
      SELECT pc.*,
        ROUND(
          pc.users_count       * (SELECT avg_row_bytes FROM table_sizes WHERE relname = 'users') +
          pc.employees_count   * (SELECT avg_row_bytes FROM table_sizes WHERE relname = 'employees') +
          pc.branches_count    * (SELECT avg_row_bytes FROM table_sizes WHERE relname = 'branches') +
          pc.devices_count     * (SELECT avg_row_bytes FROM table_sizes WHERE relname = 'devices') +
          pc.attendance_count  * (SELECT avg_row_bytes FROM table_sizes WHERE relname = 'attendance_events') +
          pc.workdays_count    * (SELECT avg_row_bytes FROM table_sizes WHERE relname = 'work_days') +
          pc.embeddings_count  * (SELECT avg_row_bytes FROM table_sizes WHERE relname = 'face_embeddings') +
          pc.payroll_count     * (SELECT avg_row_bytes FROM table_sizes WHERE relname = 'payroll_records')
        ) AS estimated_bytes
      FROM per_company pc
      ORDER BY estimated_bytes DESC
    `);

    return rows.map((r) => {
      const users = Number(r.users_count);
      const employees = Number(r.employees_count);
      const branches = Number(r.branches_count);
      const devices = Number(r.devices_count);
      const attendanceEvents = Number(r.attendance_count);
      const workDays = Number(r.workdays_count);
      const faceEmbeddings = Number(r.embeddings_count);
      const payrollRecords = Number(r.payroll_count);
      return {
        companyId: String(r.company_id),
        companyName: String(r.company_name),
        status: String(r.status),
        estimatedBytes: Number(r.estimated_bytes ?? 0),
        users,
        employees,
        branches,
        devices,
        attendanceEvents,
        workDays,
        faceEmbeddings,
        payrollRecords,
        totalRecords:
          users +
          employees +
          branches +
          devices +
          attendanceEvents +
          workDays +
          faceEmbeddings +
          payrollRecords,
        lastActivityAt: toIso(r.last_activity),
      };
    });
  }

  /** Rasm/foto URL ustunlari bo'yicha soni (fayllarning o'zi MinIO'da saqlanadi) */
  async imageStats(): Promise<ImageStats> {
    const [row]: Array<Record<string, string>> = await this.dataSource.query(`
      SELECT
        (SELECT COUNT(*) FROM "employees" WHERE jsonb_array_length(to_jsonb("photoUrls")) > 0) AS employee_photos,
        (SELECT COALESCE(SUM(jsonb_array_length(to_jsonb("photoUrls"))), 0) FROM "employees")  AS employee_photo_urls,
        (SELECT COUNT(*) FROM "face_embeddings" WHERE "sourcePhotoUrl" IS NOT NULL)            AS face_source_photos,
        (SELECT COUNT(*) FROM "attendance_events" WHERE "snapshotUrl" IS NOT NULL)             AS attendance_snapshots,
        (SELECT COUNT(*) FROM "users" WHERE "avatarUrl" IS NOT NULL)                           AS user_avatars,
        (SELECT COUNT(*) FROM "companies" WHERE "logoUrl" IS NOT NULL)                         AS company_logos
    `);

    const categories = [
      {
        category: 'employeePhotos',
        tableName: 'employees',
        column: 'photoUrls',
        count: Number(row.employee_photo_urls),
      },
      {
        category: 'faceSourcePhotos',
        tableName: 'face_embeddings',
        column: 'sourcePhotoUrl',
        count: Number(row.face_source_photos),
      },
      {
        category: 'attendanceSnapshots',
        tableName: 'attendance_events',
        column: 'snapshotUrl',
        count: Number(row.attendance_snapshots),
      },
      {
        category: 'userAvatars',
        tableName: 'users',
        column: 'avatarUrl',
        count: Number(row.user_avatars),
      },
      {
        category: 'companyLogos',
        tableName: 'companies',
        column: 'logoUrl',
        count: Number(row.company_logos),
      },
    ];
    return {
      categories,
      totalImages: categories.reduce((sum, c) => sum + c.count, 0),
    };
  }

  /** Log xarakteridagi jadvallar: qatorlar, hajm, eng eski/yangi yozuv */
  async logStats(): Promise<LogStat[]> {
    const rows: Array<Record<string, string | null>> = await this.dataSource.query(`
      SELECT * FROM (
        SELECT 'auditLogs' AS log_name, 'audit_logs' AS table_name,
          (SELECT COUNT(*) FROM "audit_logs")               AS rows_count,
          pg_total_relation_size('"audit_logs"')            AS total_bytes,
          (SELECT MIN("createdAt") FROM "audit_logs")       AS oldest_at,
          (SELECT MAX("createdAt") FROM "audit_logs")       AS newest_at
        UNION ALL
        SELECT 'notifications', 'notifications',
          (SELECT COUNT(*) FROM "notifications"),
          pg_total_relation_size('"notifications"'),
          (SELECT MIN("createdAt") FROM "notifications"),
          (SELECT MAX("createdAt") FROM "notifications")
        UNION ALL
        SELECT 'attendanceEvents', 'attendance_events',
          (SELECT COUNT(*) FROM "attendance_events"),
          pg_total_relation_size('"attendance_events"'),
          (SELECT MIN("createdAt") FROM "attendance_events"),
          (SELECT MAX("createdAt") FROM "attendance_events")
        UNION ALL
        SELECT 'storageSnapshots', 'storage_snapshots',
          (SELECT COUNT(*) FROM "storage_snapshots"),
          pg_total_relation_size('"storage_snapshots"'),
          (SELECT MIN("createdAt") FROM "storage_snapshots"),
          (SELECT MAX("createdAt") FROM "storage_snapshots")
      ) t
      ORDER BY total_bytes DESC
    `);

    return rows.map((r) => ({
      logName: String(r.log_name),
      tableName: String(r.table_name),
      rows: Number(r.rows_count),
      totalBytes: Number(r.total_bytes),
      oldestAt: toIso(r.oldest_at),
      newestAt: toIso(r.newest_at),
      growthDayBytes: null, // service snapshotlardan to'ldiradi
      lastCleanup: null, // hozircha avtomatik cleanup yo'q
    }));
  }

  /** Tozalash tavsiyalari: foydalanilmagan indekslar, dead tuples, katta loglar, soft-delete qoldiqlar */
  async cleanupRecommendations(): Promise<CleanupRecommendation[]> {
    const recommendations: CleanupRecommendation[] = [];

    // 1) Hech qachon ishlatilmagan indekslar (unique/primary bundan mustasno)
    const unusedIndexes: Array<{ index_name: string; table_name: string; index_bytes: string }> =
      await this.dataSource.query(`
        SELECT s.indexrelname AS index_name, s.relname AS table_name,
               pg_relation_size(s.indexrelid) AS index_bytes
        FROM pg_stat_user_indexes s
        JOIN pg_index i ON i.indexrelid = s.indexrelid
        WHERE s.idx_scan = 0 AND NOT i.indisunique AND NOT i.indisprimary
          AND pg_relation_size(s.indexrelid) > 8192
        ORDER BY index_bytes DESC
        LIMIT 20
      `);
    for (const idx of unusedIndexes) {
      recommendations.push({
        kind: 'UNUSED_INDEX',
        target: `${idx.table_name}.${idx.index_name}`,
        description: `"${idx.index_name}" indeksi hech qachon ishlatilmagan (idx_scan = 0)`,
        estimatedSavingBytes: Number(idx.index_bytes),
      });
    }

    // 2) Dead tuple ulushi katta jadvallar — VACUUM tavsiyasi
    const deadTables: Array<{ relname: string; dead_bytes: string; n_dead_tup: string }> =
      await this.dataSource.query(`
        SELECT s.relname, s.n_dead_tup,
               ROUND(pg_total_relation_size(c.oid)::numeric
                 * s.n_dead_tup / GREATEST(s.n_live_tup + s.n_dead_tup, 1)) AS dead_bytes
        FROM pg_stat_user_tables s
        JOIN pg_class c ON c.oid = s.relid
        WHERE s.n_dead_tup > 1000
          AND s.n_dead_tup::numeric / GREATEST(s.n_live_tup, 1) > 0.1
        ORDER BY dead_bytes DESC
        LIMIT 10
      `);
    for (const t of deadTables) {
      recommendations.push({
        kind: 'DEAD_TUPLES',
        target: t.relname,
        description: `"${t.relname}" jadvalida ${Number(t.n_dead_tup).toLocaleString()} dead tuple — VACUUM tavsiya etiladi`,
        estimatedSavingBytes: Number(t.dead_bytes),
      });
    }

    // 3) 90 kundan eski audit loglar
    const [oldAudit]: Array<{ old_count: string; est_bytes: string }> = await this.dataSource.query(`
      SELECT COUNT(*) AS old_count,
             ROUND(COUNT(*) * (pg_total_relation_size('"audit_logs"')::numeric
               / GREATEST((SELECT n_live_tup FROM pg_stat_user_tables WHERE relname = 'audit_logs'), 1))) AS est_bytes
      FROM "audit_logs" WHERE "createdAt" < now() - interval '90 days'
    `);
    if (Number(oldAudit.old_count) > 0) {
      recommendations.push({
        kind: 'LARGE_LOG',
        target: 'audit_logs',
        description: `90 kundan eski ${Number(oldAudit.old_count).toLocaleString()} ta audit log arxivlash mumkin`,
        estimatedSavingBytes: Number(oldAudit.est_bytes),
      });
    }

    // 4) Soft-delete qilingan (deletedAt) yozuvlar
    const [softDeleted]: Array<{ users_del: string; employees_del: string; est_bytes: string }> =
      await this.dataSource.query(`
        SELECT
          (SELECT COUNT(*) FROM "users" WHERE "deletedAt" IS NOT NULL)     AS users_del,
          (SELECT COUNT(*) FROM "employees" WHERE "deletedAt" IS NOT NULL) AS employees_del,
          ROUND(
            (SELECT COUNT(*) FROM "users" WHERE "deletedAt" IS NOT NULL)
              * (pg_total_relation_size('"users"')::numeric
                 / GREATEST((SELECT n_live_tup FROM pg_stat_user_tables WHERE relname = 'users'), 1)) +
            (SELECT COUNT(*) FROM "employees" WHERE "deletedAt" IS NOT NULL)
              * (pg_total_relation_size('"employees"')::numeric
                 / GREATEST((SELECT n_live_tup FROM pg_stat_user_tables WHERE relname = 'employees'), 1))
          ) AS est_bytes
      `);
    const softDeletedTotal = Number(softDeleted.users_del) + Number(softDeleted.employees_del);
    if (softDeletedTotal > 0) {
      recommendations.push({
        kind: 'SOFT_DELETED',
        target: 'users, employees',
        description: `${softDeletedTotal.toLocaleString()} ta soft-delete yozuv (users: ${softDeleted.users_del}, employees: ${softDeleted.employees_del}) butunlay o'chirilishi mumkin`,
        estimatedSavingBytes: Number(softDeleted.est_bytes),
      });
    }

    // 5) Egasiz (o'chirilgan xodimlarning) face embeddinglar
    const [orphans]: Array<{ orphan_count: string; est_bytes: string }> = await this.dataSource.query(`
      SELECT COUNT(*) AS orphan_count,
             ROUND(COUNT(*) * (pg_total_relation_size('"face_embeddings"')::numeric
               / GREATEST((SELECT n_live_tup FROM pg_stat_user_tables WHERE relname = 'face_embeddings'), 1))) AS est_bytes
      FROM "face_embeddings" fe
      JOIN "employees" e ON e.id = fe."employeeId"
      WHERE e."deletedAt" IS NOT NULL
    `);
    if (Number(orphans.orphan_count) > 0) {
      recommendations.push({
        kind: 'ORPHAN_EMBEDDINGS',
        target: 'face_embeddings',
        description: `O'chirilgan xodimlarga tegishli ${Number(orphans.orphan_count).toLocaleString()} ta face embedding tozalanishi mumkin`,
        estimatedSavingBytes: Number(orphans.est_bytes),
      });
    }

    return recommendations.sort((a, b) => b.estimatedSavingBytes - a.estimatedSavingBytes);
  }

  /** Kompaniya detail: jadval kesimida qatorlar + eng faol foydalanuvchilar */
  async companyTableBreakdown(
    companyId: string,
  ): Promise<{ tableName: string; rows: number; estimatedBytes: number }[]> {
    const rows: Array<{ table_name: string; rows_count: string; estimated_bytes: string }> =
      await this.dataSource.query(
        `
        WITH table_sizes AS (
          SELECT s.relname,
                 pg_total_relation_size(c.oid)::numeric / GREATEST(s.n_live_tup, 1) AS avg_row_bytes
          FROM pg_stat_user_tables s
          JOIN pg_class c ON c.oid = s.relid
        ),
        counts AS (
          SELECT 'users' AS table_name,
            (SELECT COUNT(*) FROM "users" WHERE "companyId" = $1) AS rows_count
          UNION ALL SELECT 'employees', (SELECT COUNT(*) FROM "employees" WHERE "companyId" = $1)
          UNION ALL SELECT 'branches', (SELECT COUNT(*) FROM "branches" WHERE "companyId" = $1)
          UNION ALL SELECT 'devices', (SELECT COUNT(*) FROM "devices" WHERE "companyId" = $1)
          UNION ALL SELECT 'roles', (SELECT COUNT(*) FROM "roles" WHERE "companyId" = $1)
          UNION ALL SELECT 'work_schedules', (SELECT COUNT(*) FROM "work_schedules" WHERE "companyId" = $1)
          UNION ALL SELECT 'subscriptions', (SELECT COUNT(*) FROM "subscriptions" WHERE "companyId" = $1)
          UNION ALL SELECT 'payments', (SELECT COUNT(*) FROM "payments" WHERE "companyId" = $1)
          UNION ALL SELECT 'audit_logs', (SELECT COUNT(*) FROM "audit_logs" WHERE "companyId" = $1)
          UNION ALL SELECT 'attendance_events',
            (SELECT COUNT(*) FROM "attendance_events" ae
             JOIN "employees" e ON e.id = ae."employeeId" WHERE e."companyId" = $1)
          UNION ALL SELECT 'work_days',
            (SELECT COUNT(*) FROM "work_days" wd
             JOIN "employees" e ON e.id = wd."employeeId" WHERE e."companyId" = $1)
          UNION ALL SELECT 'face_embeddings',
            (SELECT COUNT(*) FROM "face_embeddings" fe
             JOIN "employees" e ON e.id = fe."employeeId" WHERE e."companyId" = $1)
          UNION ALL SELECT 'payroll_records',
            (SELECT COUNT(*) FROM "payroll_records" pr
             JOIN "employees" e ON e.id = pr."employeeId" WHERE e."companyId" = $1)
        )
        SELECT c.table_name, c.rows_count,
               ROUND(c.rows_count * COALESCE(ts.avg_row_bytes, 0)) AS estimated_bytes
        FROM counts c
        LEFT JOIN table_sizes ts ON ts.relname = c.table_name
        WHERE c.rows_count > 0
        ORDER BY estimated_bytes DESC
        `,
        [companyId],
      );
    return rows.map((r) => ({
      tableName: r.table_name,
      rows: Number(r.rows_count),
      estimatedBytes: Number(r.estimated_bytes),
    }));
  }

  /** Kompaniyaning eng faol foydalanuvchilari (audit loglar soni bo'yicha) */
  async companyTopUsers(
    companyId: string,
    limit: number,
  ): Promise<{ userId: string; username: string | null; auditCount: number }[]> {
    const rows: Array<{ user_id: string; username: string | null; audit_count: string }> =
      await this.dataSource.query(
        `
        SELECT a."userId" AS user_id, u.username, COUNT(*) AS audit_count
        FROM "audit_logs" a
        LEFT JOIN "users" u ON u.id = a."userId"
        WHERE a."companyId" = $1 AND a."userId" IS NOT NULL
        GROUP BY a."userId", u.username
        ORDER BY audit_count DESC
        LIMIT $2
        `,
        [companyId, limit],
      );
    return rows.map((r) => ({
      userId: r.user_id,
      username: r.username,
      auditCount: Number(r.audit_count),
    }));
  }

  /** Kompaniya rasm ko'rsatkichlari (detail sahifa uchun) */
  async companyImageCounts(companyId: string): Promise<{
    employeePhotos: number;
    faceSourcePhotos: number;
    attendanceSnapshots: number;
  }> {
    const [row]: Array<Record<string, string>> = await this.dataSource.query(
      `
      SELECT
        (SELECT COALESCE(SUM(jsonb_array_length(to_jsonb("photoUrls"))), 0)
           FROM "employees" WHERE "companyId" = $1)                          AS employee_photos,
        (SELECT COUNT(*) FROM "face_embeddings" fe
           JOIN "employees" e ON e.id = fe."employeeId"
           WHERE e."companyId" = $1 AND fe."sourcePhotoUrl" IS NOT NULL)     AS face_source_photos,
        (SELECT COUNT(*) FROM "attendance_events" ae
           JOIN "employees" e ON e.id = ae."employeeId"
           WHERE e."companyId" = $1 AND ae."snapshotUrl" IS NOT NULL)        AS attendance_snapshots
      `,
      [companyId],
    );
    return {
      employeePhotos: Number(row.employee_photos),
      faceSourcePhotos: Number(row.face_source_photos),
      attendanceSnapshots: Number(row.attendance_snapshots),
    };
  }

  private mapTableRow(r: Record<string, string | null>): TableStat {
    const liveRows = Number(r.live_rows);
    const deadTuples = Number(r.dead_tuples);
    const modSinceAnalyze = Number(r.mod_since_analyze);
    return {
      tableName: String(r.tableName),
      liveRows,
      deadTuples,
      tableBytes: Number(r.table_bytes),
      indexBytes: Number(r.index_bytes),
      toastBytes: Number(r.toast_bytes),
      totalBytes: Number(r.total_bytes),
      seqScan: Number(r.seq_scan),
      idxScan: Number(r.idx_scan),
      lastVacuum: toIso(r.last_vacuum),
      lastAutovacuum: toIso(r.last_autovacuum),
      lastAnalyze: toIso(r.last_analyze),
      lastAutoanalyze: toIso(r.last_autoanalyze),
      lastUpdated: toIso(r.last_updated),
      vacuumStatus: deadTuples > 1000 && deadTuples / Math.max(liveRows, 1) > 0.1 ? 'NEEDS_VACUUM' : 'OK',
      analyzeStatus:
        modSinceAnalyze > 1000 && modSinceAnalyze / Math.max(liveRows, 1) > 0.1 ? 'STALE' : 'OK',
    };
  }
}
