import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { StorageSnapshot } from '../../entities/storage-snapshot.entity';
import { REDIS_CLIENT } from '../redis/redis.module';
import { StorageAnalyticsService } from './storage-analytics.service';
import { StorageStatsRepository } from './storage-stats.repository';
import { CompanyStorageStat, TableStat } from './interfaces/storage-analytics.interfaces';
import { CompanyStorageQueryDto, ModelListQueryDto } from './dto/storage-analytics.dtos';

const GB = 1024 * 1024 * 1024;

function makeTableStat(overrides: Partial<TableStat>): TableStat {
  return {
    tableName: 'users',
    liveRows: 100,
    deadTuples: 0,
    tableBytes: 1000,
    indexBytes: 500,
    toastBytes: 0,
    totalBytes: 1500,
    seqScan: 0,
    idxScan: 0,
    lastVacuum: null,
    lastAutovacuum: null,
    lastAnalyze: null,
    lastAutoanalyze: null,
    lastUpdated: null,
    vacuumStatus: 'OK',
    analyzeStatus: 'OK',
    ...overrides,
  };
}

function makeCompanyStat(overrides: Partial<CompanyStorageStat>): CompanyStorageStat {
  return {
    companyId: 'c1',
    companyName: 'Alpha',
    status: 'ACTIVE',
    estimatedBytes: 1000,
    users: 1,
    employees: 2,
    branches: 1,
    devices: 1,
    attendanceEvents: 10,
    workDays: 10,
    faceEmbeddings: 2,
    payrollRecords: 2,
    totalRecords: 29,
    lastActivityAt: null,
    ...overrides,
  };
}

function paginationQuery<T extends { page: number; limit: number }>(
  cls: new () => T,
  overrides: Partial<T> = {},
): T {
  const dto = new cls();
  Object.assign(dto, overrides);
  return dto;
}

describe('StorageAnalyticsService', () => {
  let service: StorageAnalyticsService;
  const statsRepository = {
    databaseStat: jest.fn(),
    companyUsage: jest.fn(),
    topTables: jest.fn(),
    findTables: jest.fn(),
    imageStats: jest.fn(),
    logStats: jest.fn(),
    cleanupRecommendations: jest.fn(),
    companyTableBreakdown: jest.fn(),
    companyTopUsers: jest.fn(),
    companyImageCounts: jest.fn(),
  };
  const snapshotQueryBuilder = {
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(null),
  };
  const snapshotRepository = {
    find: jest.fn().mockResolvedValue([]),
    createQueryBuilder: jest.fn(() => snapshotQueryBuilder),
  };
  // Redis o'chirilgan holatni simulyatsiya qilamiz — servis to'g'ridan-to'g'ri hisoblashi kerak
  const redis = {
    get: jest.fn().mockRejectedValue(new Error('redis down')),
    set: jest.fn().mockRejectedValue(new Error('redis down')),
  };
  const config = { get: jest.fn((key: string) => (key === 'STORAGE_ALERT_LIMIT_GB' ? 10 : undefined)) };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        StorageAnalyticsService,
        { provide: StorageStatsRepository, useValue: statsRepository },
        { provide: getRepositoryToken(StorageSnapshot), useValue: snapshotRepository },
        { provide: getDataSourceToken(), useValue: { query: jest.fn().mockResolvedValue([]) } },
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = moduleRef.get(StorageAnalyticsService);
  });

  describe('buildAlert', () => {
    it('80% dan past — OK', () => {
      const alert = service.buildAlert(7 * GB);
      expect(alert.level).toBe('OK');
      expect(alert.message).toBeNull();
    });

    it('80% — WARNING', () => {
      expect(service.buildAlert(8 * GB).level).toBe('WARNING');
    });

    it('90% — CRITICAL', () => {
      expect(service.buildAlert(9 * GB).level).toBe('CRITICAL');
    });

    it('95% — EMERGENCY', () => {
      expect(service.buildAlert(9.6 * GB).level).toBe('EMERGENCY');
    });
  });

  describe('companies', () => {
    beforeEach(() => {
      statsRepository.companyUsage.mockResolvedValue([
        makeCompanyStat({ companyId: 'c1', companyName: 'Alpha', estimatedBytes: 3000 }),
        makeCompanyStat({ companyId: 'c2', companyName: 'Beta', estimatedBytes: 1000 }),
        makeCompanyStat({ companyId: 'c3', companyName: 'Gamma', estimatedBytes: 2000 }),
      ]);
    });

    it('standart: hajm bo‘yicha kamayish tartibida', async () => {
      const result = await service.companies(paginationQuery(CompanyStorageQueryDto));
      expect(result.items.map((c) => c.companyId)).toEqual(['c1', 'c3', 'c2']);
      expect(result.meta.total).toBe(3);
    });

    it('search — nom bo‘yicha filtr', async () => {
      const result = await service.companies(
        paginationQuery(CompanyStorageQueryDto, { search: 'bet' }),
      );
      expect(result.items).toHaveLength(1);
      expect(result.items[0].companyName).toBe('Beta');
    });

    it('companyId filtri', async () => {
      const result = await service.companies(
        paginationQuery(CompanyStorageQueryDto, { companyId: 'c3' }),
      );
      expect(result.items).toHaveLength(1);
      expect(result.items[0].companyId).toBe('c3');
    });

    it('pagination meta to‘g‘ri hisoblanadi', async () => {
      const result = await service.companies(
        paginationQuery(CompanyStorageQueryDto, { page: 2, limit: 2 }),
      );
      expect(result.items).toHaveLength(1);
      expect(result.meta.totalPages).toBe(2);
    });
  });

  describe('models', () => {
    it('faqat ma’lum entitylarni qaytaradi va sortlaydi', async () => {
      statsRepository.findTables.mockResolvedValue({
        items: [
          makeTableStat({ tableName: 'users', totalBytes: 100 }),
          makeTableStat({ tableName: 'employees', totalBytes: 300 }),
          makeTableStat({ tableName: 'pg_internal_tmp', totalBytes: 999 }),
        ],
        total: 3,
      });
      const result = await service.models(paginationQuery(ModelListQueryDto));
      expect(result.items.map((m) => m.entityName)).toEqual(['Employee', 'User']);
      // Snapshotlar yo'q — growth null
      expect(result.items[0].growthTodayBytes).toBeNull();
    });

    it('entityName filtri ishlaydi', async () => {
      statsRepository.findTables.mockResolvedValue({
        items: [
          makeTableStat({ tableName: 'users' }),
          makeTableStat({ tableName: 'employees' }),
        ],
        total: 2,
      });
      const result = await service.models(
        paginationQuery(ModelListQueryDto, { entityName: 'employee' }),
      );
      expect(result.items).toHaveLength(1);
      expect(result.items[0].entityName).toBe('Employee');
    });
  });

  describe('companyDetail', () => {
    it('mavjud bo‘lmagan kompaniya uchun NOT_FOUND', async () => {
      statsRepository.companyUsage.mockResolvedValue([]);
      await expect(service.companyDetail('missing-id')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  describe('dashboard', () => {
    it('kartalar va taqsimotni yig‘adi (Redis ishlamasa ham)', async () => {
      statsRepository.databaseStat.mockResolvedValue({
        databaseName: 'faceid',
        databaseSizeBytes: 5 * GB,
        storageLimitBytes: 10 * GB,
        usedPercent: 50,
        freeBytes: 5 * GB,
        totalTables: 20,
        totalRows: 1000,
        numBackends: 2,
        xactCommit: 10,
        xactRollback: 0,
        cacheHitRatio: 99,
        tempFiles: 0,
        tempBytes: 0,
        deadlocks: 0,
        statsReset: null,
        postgresVersion: 'PostgreSQL 16',
      });
      statsRepository.companyUsage.mockResolvedValue([
        makeCompanyStat({ estimatedBytes: 4000 }),
        makeCompanyStat({ companyId: 'c2', companyName: 'Beta', estimatedBytes: 1000 }),
      ]);
      statsRepository.topTables.mockResolvedValue([{ tableName: 'users', totalBytes: 100 }]);

      const dash = await service.dashboard();
      expect(dash.totalCompanies).toBe(2);
      expect(dash.largestCompany?.companyName).toBe('Alpha');
      expect(dash.avgCompanyBytes).toBe(2500);
      expect(dash.alert.level).toBe('OK');
      expect(dash.companyDistribution[0].percent).toBe(80);
    });
  });
});
