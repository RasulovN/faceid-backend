/**
 * Storage Analytics moduli uchun umumiy tiplar.
 * Barcha hajmlar baytlarda (number) — UI o'zi formatlaydi.
 */

/** pg_stat_user_tables + pg_class dan yig'ilgan bitta jadval statistikasi */
export interface TableStat {
  tableName: string;
  /** n_live_tup — taxminiy jonli qatorlar soni (COUNT emas, statistika) */
  liveRows: number;
  deadTuples: number;
  tableBytes: number;
  indexBytes: number;
  toastBytes: number;
  totalBytes: number;
  seqScan: number;
  idxScan: number;
  lastVacuum: string | null;
  lastAutovacuum: string | null;
  lastAnalyze: string | null;
  lastAutoanalyze: string | null;
  /** Oxirgi statistika yangilanishi (vacuum/analyze dan eng so'nggisi) */
  lastUpdated: string | null;
  /** OK | NEEDS_VACUUM — dead tuple ulushi 10% dan oshsa */
  vacuumStatus: 'OK' | 'NEEDS_VACUUM';
  /** OK | STALE — analyze'dan keyin o'zgargan qatorlar 10% dan oshsa */
  analyzeStatus: 'OK' | 'STALE';
}

/** pg_stat_database dan joriy baza ko'rsatkichlari */
export interface DatabaseStat {
  databaseName: string;
  databaseSizeBytes: number;
  /** STORAGE_ALERT_LIMIT_GB dan hisoblangan yumshoq limit */
  storageLimitBytes: number;
  usedPercent: number;
  freeBytes: number;
  totalTables: number;
  totalRows: number;
  numBackends: number;
  xactCommit: number;
  xactRollback: number;
  /** blks_hit / (blks_hit + blks_read) — kesh samaradorligi, % */
  cacheHitRatio: number;
  tempFiles: number;
  tempBytes: number;
  deadlocks: number;
  statsReset: string | null;
  postgresVersion: string;
}

/** Kompaniya bo'yicha saqlash hajmi (taxminiy: qator ulushi × jadval hajmi) */
export interface CompanyStorageStat {
  companyId: string;
  companyName: string;
  status: string;
  estimatedBytes: number;
  users: number;
  employees: number;
  branches: number;
  devices: number;
  attendanceEvents: number;
  workDays: number;
  faceEmbeddings: number;
  payrollRecords: number;
  totalRecords: number;
  lastActivityAt: string | null;
}

/** Entity (model) darajasidagi statistika */
export interface ModelStat {
  entityName: string;
  tableName: string;
  rows: number;
  totalBytes: number;
  avgRowBytes: number;
  /** Snapshotlar farqidan — bugungi o'sish (bayt) */
  growthTodayBytes: number | null;
  /** Snapshotlar farqidan — shu oydagi o'sish (bayt) */
  growthMonthBytes: number | null;
}

/** Bir davr uchun o'sish ko'rsatkichi */
export interface GrowthPoint {
  period: 'today' | 'yesterday' | 'week' | 'month' | 'year';
  bytes: number | null;
}

export interface GrowthAnalytics {
  points: GrowthPoint[];
  /** Kunlik o'sish grafigi uchun: sana → o'sha kundagi o'sish (bayt) */
  daily: { date: string; deltaBytes: number; totalBytes: number }[];
  /** Oylik dinamika: oy → oy oxiridagi umumiy hajm */
  monthly: { month: string; totalBytes: number }[];
}

/** Rasm (URL ustunlari) statistikasi — fayllarning o'zi MinIO'da */
export interface ImageStats {
  categories: {
    category: string;
    tableName: string;
    column: string;
    count: number;
  }[];
  totalImages: number;
}

/** Log jadvallari statistikasi */
export interface LogStat {
  logName: string;
  tableName: string;
  rows: number;
  totalBytes: number;
  oldestAt: string | null;
  newestAt: string | null;
  /** Snapshotlardan — oxirgi 24 soatdagi o'sish */
  growthDayBytes: number | null;
  lastCleanup: string | null;
}

/** Tozalash tavsiyasi */
export interface CleanupRecommendation {
  kind:
    | 'UNUSED_INDEX'
    | 'DEAD_TUPLES'
    | 'LARGE_LOG'
    | 'OLD_SNAPSHOTS'
    | 'ORPHAN_EMBEDDINGS'
    | 'SOFT_DELETED';
  target: string;
  description: string;
  estimatedSavingBytes: number;
}

export type StorageAlertLevel = 'OK' | 'WARNING' | 'CRITICAL' | 'EMERGENCY';

export interface StorageAlert {
  level: StorageAlertLevel;
  usedPercent: number;
  databaseSizeBytes: number;
  storageLimitBytes: number;
  message: string | null;
}

/** Dashboard yuqori kartalar + chartlar uchun yig'ma javob */
export interface StorageDashboard {
  databaseSizeBytes: number;
  storageLimitBytes: number;
  usedPercent: number;
  freeBytes: number;
  totalTables: number;
  totalRows: number;
  totalCompanies: number;
  avgCompanyBytes: number;
  largestCompany: { companyId: string; companyName: string; estimatedBytes: number } | null;
  alert: StorageAlert;
  topTables: { tableName: string; totalBytes: number }[];
  companyDistribution: { companyName: string; estimatedBytes: number; percent: number }[];
  monthlyGrowth: { month: string; totalBytes: number }[];
  dailyGrowth: { date: string; deltaBytes: number }[];
}

/** Kompaniya detail sahifasi */
export interface CompanyStorageDetail {
  company: CompanyStorageStat;
  /** Jadval bo'yicha taqsimot (qator soni + taxminiy hajm) */
  tableBreakdown: { tableName: string; rows: number; estimatedBytes: number }[];
  /** Snapshotlardan kompaniya hajmi dinamikasi */
  timeline: { date: string; estimatedBytes: number }[];
  /** Eng faol foydalanuvchilar (audit loglar bo'yicha) */
  topUsers: { userId: string; username: string | null; auditCount: number }[];
  images: { employeePhotos: number; faceSourcePhotos: number; attendanceSnapshots: number };
}

/** Snapshot jsonb ustunlari ichidagi elementlar */
export interface SnapshotCompanyEntry {
  companyId: string;
  companyName: string;
  estimatedBytes: number;
  totalRecords: number;
}

export interface SnapshotTableEntry {
  tableName: string;
  totalBytes: number;
  rows: number;
}
