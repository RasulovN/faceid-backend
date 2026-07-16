import { EmployeesService } from './employees.service';
import { PersonType, SalaryType } from '../../common/enums';
import { CreateEmployeeDto } from './dto/employee.dtos';

describe('EmployeesService.create (STUDENT — o‘quvchi yaratish)', () => {
  let service: EmployeesService;
  let employeeRepository: any;
  let userRepository: any;
  let branchRepository: any;
  let embeddingRepository: any;
  let tariffLimitsService: { assertCanCreate: jest.Mock };
  let dataSource: any;

  beforeEach(() => {
    employeeRepository = {
      find: jest.fn(async () => []), // generateTabNumber uchun
      exists: jest.fn(async () => false),
      create: jest.fn((x: any) => x),
      save: jest.fn(async (x: any) => ({ ...x, id: 'st-1' })),
      findOne: jest.fn(async () => ({
        id: 'st-1',
        firstName: 'Ali',
        lastName: 'Valiyev',
        fullName: 'Valiyev Ali',
        personType: PersonType.STUDENT,
        parentPhones: ['+998901112233'],
        photoUrls: [],
        userId: null,
      })),
    };
    userRepository = {
      exists: jest.fn(async () => false),
      update: jest.fn(async () => undefined),
    };
    branchRepository = { findOne: jest.fn(async () => ({ id: 'b1', companyId: 'c1' })) };
    embeddingRepository = { find: jest.fn(async () => []) };
    tariffLimitsService = { assertCanCreate: jest.fn(async () => undefined) };
    dataSource = { transaction: jest.fn() };

    service = new EmployeesService(
      employeeRepository,
      userRepository,
      branchRepository,
      {} as any, // companyRepository
      embeddingRepository,
      {} as any, // workDayRepository
      {} as any, // eventRepository
      {} as any, // scheduleRepository
      dataSource,
      { get: jest.fn() } as any, // config
      {} as any, // faceService
      {} as any, // minioService
      {} as any, // mailService
      tariffLimitsService as any,
    );
  });

  const studentDto = {
    personType: PersonType.STUDENT,
    firstName: 'Ali',
    lastName: 'Valiyev',
    branchId: 'b1',
    parentPhones: ['+998901112233', '+998901112233', '+998907654321'],
  } as CreateEmployeeDto;

  it('User yozuvi va tranzaksiya YARATILMAYDI, userId=null, raqamlar dedupe qilinadi', async () => {
    await service.create('c1', studentDto);
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(employeeRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        personType: PersonType.STUDENT,
        userId: null,
        parentPhones: ['+998901112233', '+998907654321'],
      }),
    );
  });

  it("tarif 'xodim' limiti tekshirilmaydi (o'quvchilar limitga kirmaydi)", async () => {
    await service.create('c1', studentDto);
    expect(tariffLimitsService.assertCanCreate).not.toHaveBeenCalled();
  });

  it("tab raqami S- prefiksi bilan avto-generatsiya qilinadi", async () => {
    await service.create('c1', studentDto);
    expect(employeeRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ tabNumber: 'S-001' }),
    );
  });

  it("maosh berilmasa default FIXED/0 qo'yiladi", async () => {
    await service.create('c1', studentDto);
    expect(employeeRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ salaryType: SalaryType.FIXED, salaryAmount: 0 }),
    );
  });

  it("mavjud S- raqamlardan keyingisi tanlanadi, T- raqamlar aralashmaydi", async () => {
    employeeRepository.find.mockResolvedValue([
      { tabNumber: 'T-042' },
      { tabNumber: 'S-007' },
    ]);
    await service.create('c1', studentDto);
    expect(employeeRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ tabNumber: 'S-008' }),
    );
  });

  it('EMPLOYEE uchun credentials bo‘lmasa validation xatosi', async () => {
    await expect(
      service.create('c1', {
        firstName: 'A',
        lastName: 'B',
        branchId: 'b1',
      } as CreateEmployeeDto),
    ).rejects.toThrow('credentials');
    expect(tariffLimitsService.assertCanCreate).toHaveBeenCalled();
  });
});
