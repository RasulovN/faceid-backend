import { EmployeesService } from './employees.service';
import { Employee } from '../../entities/employee.entity';

describe('EmployeesService (addPhotos dublikat yuz tekshiruvi)', () => {
  let service: EmployeesService;
  let employeeRepository: any;
  let embeddingRepository: any;
  let faceService: { extract: jest.Mock };
  let minioService: any;

  const employee = {
    id: 'emp-2',
    companyId: 'c1',
    photoUrls: [],
  } as unknown as Employee;

  beforeEach(() => {
    employeeRepository = {
      findOne: jest.fn(async () => employee),
      save: jest.fn(async (e: any) => e),
    };
    embeddingRepository = {
      query: jest.fn(async () => []),
      insert: jest.fn(async () => undefined),
    };
    faceService = {
      extract: jest.fn(async () => ({ ok: true, embedding: [0.1, 0.2, 0.3], quality: 0.9 })),
    };
    minioService = {
      employeesBucket: 'employees',
      uploadWithKey: jest.fn(async () => 'http://minio/photo.jpg'),
    };

    service = new EmployeesService(
      employeeRepository,
      {} as any, // userRepository
      {} as any, // branchRepository
      {} as any, // companyRepository
      embeddingRepository,
      {} as any, // workDayRepository
      {} as any, // eventRepository
      {} as any, // scheduleRepository
      {} as any, // dataSource
      { get: jest.fn(() => '0.5') } as any, // config
      faceService as any,
      minioService as any,
      {} as any, // mailService
      {} as any, // tariffLimitsService
    );
  });

  const file = { buffer: Buffer.from('img'), mimetype: 'image/jpeg' } as any;

  it("boshqa xodimning yuzi (similarity ≥ threshold) → FACE_ALREADY_ENROLLED, SAQLANMAYDI", async () => {
    embeddingRepository.query.mockResolvedValue([
      { employeeId: 'emp-1', firstName: 'Aziz', lastName: 'Karimov', similarity: '0.83' },
    ]);
    const results = await service.addPhotos('c1', 'emp-2', [file]);
    expect(results[0]).toMatchObject({
      ok: false,
      errorCode: 'FACE_ALREADY_ENROLLED',
      duplicateOf: { id: 'emp-1', fullName: 'Karimov Aziz' },
    });
    expect(embeddingRepository.insert).not.toHaveBeenCalled();
    expect(minioService.uploadWithKey).not.toHaveBeenCalled();
  });

  it('o‘xshashlik threshold’dan past → rasm normal saqlanadi', async () => {
    embeddingRepository.query.mockResolvedValue([
      { employeeId: 'emp-1', firstName: 'Aziz', lastName: 'Karimov', similarity: '0.31' },
    ]);
    const results = await service.addPhotos('c1', 'emp-2', [file]);
    expect(results[0]).toMatchObject({ ok: true, quality: 0.9 });
    expect(embeddingRepository.insert).toHaveBeenCalled();
  });

  it('kompaniyada boshqa embedding yo‘q → rasm saqlanadi', async () => {
    const results = await service.addPhotos('c1', 'emp-2', [file]);
    expect(results[0].ok).toBe(true);
    expect(embeddingRepository.insert).toHaveBeenCalled();
  });

  it('yuz topilmagan rasm dublikat tekshiruvisiz rad etiladi', async () => {
    faceService.extract.mockResolvedValue({ ok: false, errorCode: 'FACE_NOT_FOUND' });
    const results = await service.addPhotos('c1', 'emp-2', [file]);
    expect(results[0]).toMatchObject({ ok: false, errorCode: 'FACE_NOT_FOUND' });
    expect(embeddingRepository.query).not.toHaveBeenCalled();
  });
});
