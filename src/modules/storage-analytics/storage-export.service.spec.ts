import { Test } from '@nestjs/testing';
import { Paginated } from '../../common/dto/pagination.dto';
import { StorageAnalyticsService } from './storage-analytics.service';
import { StorageExportService } from './storage-export.service';
import { TableStat } from './interfaces/storage-analytics.interfaces';

const tableStat: TableStat = {
  tableName: 'attendance_events',
  liveRows: 1280221,
  deadTuples: 12,
  tableBytes: 2_800_000,
  indexBytes: 180_000,
  toastBytes: 40_000,
  totalBytes: 3_020_000,
  seqScan: 5,
  idxScan: 900,
  lastVacuum: null,
  lastAutovacuum: null,
  lastAnalyze: null,
  lastAutoanalyze: null,
  lastUpdated: null,
  vacuumStatus: 'OK',
  analyzeStatus: 'OK',
};

describe('StorageExportService', () => {
  let service: StorageExportService;
  const analytics = {
    tables: jest.fn(),
    companies: jest.fn(),
    models: jest.fn(),
    logs: jest.fn(),
    recommendations: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        StorageExportService,
        { provide: StorageAnalyticsService, useValue: analytics },
      ],
    }).compile();
    service = moduleRef.get(StorageExportService);
  });

  it('xlsx — bo‘sh bo‘lmagan buffer qaytaradi', async () => {
    analytics.tables.mockResolvedValue(Paginated.of([tableStat], 1, { page: 1, limit: 100 }));
    const buffer = await service.export('tables', 'xlsx');
    expect(Buffer.isBuffer(buffer)).toBe(true);
    // XLSX — zip formati, "PK" bilan boshlanadi
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
  });

  it('csv — maxsus belgilarni escape qiladi', async () => {
    analytics.recommendations.mockResolvedValue({
      items: [
        {
          kind: 'LARGE_LOG',
          target: 'audit_logs',
          description: 'Vergul, va "qo\'shtirnoq" bor',
          estimatedSavingBytes: 1024,
        },
      ],
      totalSavingBytes: 1024,
    });
    const buffer = await service.export('recommendations', 'csv');
    const text = buffer.toString('utf8');
    expect(text).toContain('"Vergul, va ""qo\'shtirnoq"" bor"');
    expect(text).toContain('1.0 KB');
  });

  it('pdf — %PDF sarlavhali buffer qaytaradi', async () => {
    analytics.logs.mockResolvedValue([
      {
        logName: 'auditLogs',
        tableName: 'audit_logs',
        rows: 10,
        totalBytes: 2048,
        oldestAt: null,
        newestAt: null,
        growthDayBytes: null,
        lastCleanup: null,
      },
    ]);
    const buffer = await service.export('logs', 'pdf');
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('fayl nomi hisobot va formatni o‘z ichiga oladi', () => {
    const name = service.buildFileName('companies', 'csv');
    expect(name).toMatch(/^storage-companies-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
