import { AttendanceService } from './attendance.service';
import {
  AttendanceEventType,
  DeviceDirection,
  EmployeeStatus,
  UserRole,
} from '../../common/enums';
import { Device } from '../../entities/device.entity';
import { Employee } from '../../entities/employee.entity';

describe('AttendanceService (kiosk debounce / mobile geofence)', () => {
  let service: AttendanceService;
  let eventRepository: any;
  let employeeRepository: any;
  let companyRepository: any;
  let workDayRepository: any;
  let embeddingRepository: any;
  let redis: { get: jest.Mock; set: jest.Mock };
  let faceService: { identify: jest.Mock; verify: jest.Mock };
  let auditService: { log: jest.Mock };
  let wsService: { emitAttendanceNew: jest.Mock };
  let workDayService: { recalc: jest.Mock };

  const device = {
    id: 'dev-1',
    companyId: 'c1',
    branchId: 'b1',
    direction: DeviceDirection.BOTH,
    isActive: true,
  } as Device;

  const employee = {
    id: 'emp-1',
    companyId: 'c1',
    branchId: 'b1',
    userId: 'u1',
    firstName: 'Aziz',
    lastName: 'Karimov',
    status: EmployeeStatus.ACTIVE,
    photoUrls: [],
    branch: {
      id: 'b1',
      latitude: 41.311081,
      longitude: 69.240562,
      geofenceRadius: 50,
    },
    get fullName() {
      return 'Karimov Aziz';
    },
  } as unknown as Employee;

  beforeEach(() => {
    eventRepository = {
      save: jest.fn(async (e: any) => ({ ...e, id: 'evt-1' })),
      create: jest.fn((e: any) => e),
      findOne: jest.fn(async () => null),
      query: jest.fn(async () => [{ count: 0 }]),
    };
    employeeRepository = {
      findOne: jest.fn(async () => employee),
      count: jest.fn(async () => 5),
    };
    companyRepository = {
      findOne: jest.fn(async () => ({ id: 'c1', timezone: 'Asia/Tashkent' })),
    };
    workDayRepository = {
      createQueryBuilder: jest.fn(() => ({
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn(async () => []),
      })),
    };
    embeddingRepository = { find: jest.fn(async () => [{ embedding: [0.1, 0.2] }]) };
    redis = { get: jest.fn(async () => null), set: jest.fn() };
    faceService = {
      identify: jest.fn(async () => ({
        matched: true,
        employeeId: 'emp-1',
        confidence: 0.92,
        livenessScore: 0.95,
      })),
      verify: jest.fn(async () => ({ match: true, confidence: 0.9, livenessScore: 0.9 })),
    };
    auditService = { log: jest.fn() };
    wsService = { emitAttendanceNew: jest.fn() };
    workDayService = { recalc: jest.fn() };

    service = new AttendanceService(
      eventRepository,
      employeeRepository,
      {} as any, // branchRepository
      companyRepository,
      workDayRepository,
      embeddingRepository,
      redis as any,
      {
        get: jest.fn((key: string) =>
          ({ LIVENESS_THRESHOLD: '0.7', ATTENDANCE_DEBOUNCE_SECONDS: '60' })[key],
        ),
      } as any,
      faceService as any,
      { upload: jest.fn(async () => 'http://minio/snap.jpg'), snapshotsBucket: 'snaps' } as any,
      workDayService as any,
      wsService as any,
      auditService as any,
    );
  });

  describe('kiosk debounce', () => {
    it('debounce oynasida takror urinish duplicate qaytaradi', async () => {
      redis.get.mockResolvedValue(
        JSON.stringify({
          eventId: 'evt-0',
          type: AttendanceEventType.CHECK_IN,
          timestamp: new Date().toISOString(),
        }),
      );
      const result = await service.kioskRecognize(device, Buffer.from('frame'));
      expect(result).toMatchObject({ recognized: true, duplicate: true });
      expect(eventRepository.save).not.toHaveBeenCalled();
    });

    it('yangi event yaratilganda debounce kaliti o‘rnatiladi', async () => {
      const result = await service.kioskRecognize(device, Buffer.from('frame'));
      expect(result).toMatchObject({ recognized: true });
      expect(redis.set).toHaveBeenCalledWith(
        'attendance:debounce:emp-1',
        expect.any(String),
        'EX',
        60,
      );
      expect(wsService.emitAttendanceNew).toHaveBeenCalled();
    });

    it('direction=BOTH: oxirgi event CHECK_IN bo‘lsa CHECK_OUT yoziladi', async () => {
      eventRepository.findOne.mockResolvedValue({ type: AttendanceEventType.CHECK_IN });
      await service.kioskRecognize(device, Buffer.from('frame'));
      expect(eventRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ type: AttendanceEventType.CHECK_OUT }),
      );
    });

    it('liveness past bo‘lsa event yozilmaydi', async () => {
      faceService.identify.mockResolvedValue({
        matched: true,
        employeeId: 'emp-1',
        confidence: 0.9,
        livenessScore: 0.3,
      });
      const result = await service.kioskRecognize(device, Buffer.from('frame'));
      expect(result).toEqual({ recognized: false, reason: 'LIVENESS_FAILED' });
      expect(eventRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('mobile geofence', () => {
    const user = { id: 'u1', username: 'emp1', role: UserRole.EMPLOYEE, companyId: 'c1' };

    it('geofence tashqarisida → OUT_OF_GEOFENCE (distance details bilan)', async () => {
      await expect(
        service.mobileCheck(user, Buffer.from('selfie'), {
          latitude: 41.326, // ~1.9 km uzoqda
          longitude: 69.228,
          accuracy: 5,
          isMockLocation: false,
          type: AttendanceEventType.CHECK_IN,
        }),
      ).rejects.toMatchObject({
        code: 'OUT_OF_GEOFENCE',
        details: { distance: expect.any(Number) },
      });
      expect(eventRepository.save).not.toHaveBeenCalled();
    });

    it('mock location → MOCK_LOCATION + suspicious audit yoziladi', async () => {
      await expect(
        service.mobileCheck(user, Buffer.from('selfie'), {
          latitude: 41.311081,
          longitude: 69.240562,
          accuracy: 5,
          isMockLocation: true,
          type: AttendanceEventType.CHECK_IN,
        }),
      ).rejects.toMatchObject({ code: 'MOCK_LOCATION' });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'attendance.mockLocationAttempt' }),
      );
    });

    it('geofence ichida + yuz tasdiqlangan → event yaratiladi', async () => {
      const result = await service.mobileCheck(user, Buffer.from('selfie'), {
        latitude: 41.311081,
        longitude: 69.240562,
        accuracy: 5,
        isMockLocation: false,
        type: AttendanceEventType.CHECK_IN,
      });
      expect(result.ok).toBe(true);
      expect(eventRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'MOBILE', type: AttendanceEventType.CHECK_IN }),
      );
    });

    it('debounce faol bo‘lsa → DEBOUNCE (429)', async () => {
      redis.get.mockResolvedValue(JSON.stringify({ eventId: 'evt-0' }));
      await expect(
        service.mobileCheck(user, Buffer.from('selfie'), {
          latitude: 41.311081,
          longitude: 69.240562,
          accuracy: 5,
          isMockLocation: false,
          type: AttendanceEventType.CHECK_IN,
        }),
      ).rejects.toMatchObject({ code: 'DEBOUNCE' });
    });
  });
});
