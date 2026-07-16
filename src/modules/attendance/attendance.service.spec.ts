import { AttendanceService } from './attendance.service';
import {
  AttendanceEventType,
  DeviceDirection,
  EmployeeStatus,
  UserRole,
} from '../../common/enums';
import { Device } from '../../entities/device.entity';
import { Employee } from '../../entities/employee.entity';
import { ErrorCodes } from '../../common/constants/error-codes';

describe('AttendanceService (kiosk debounce / mobile geofence)', () => {
  let service: AttendanceService;
  let eventRepository: any;
  let employeeRepository: any;
  let companyRepository: any;
  let workDayRepository: any;
  let embeddingRepository: any;
  let redis: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  let faceService: { identify: jest.Mock; verify: jest.Mock; verifyLive: jest.Mock };
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
    // ioredis `SET ... NX` kalit yo'q bo'lsa 'OK', bor bo'lsa null qaytaradi —
    // claimDebounce shu qiymatga tayanadi (default: muvaffaqiyatli claim).
    redis = { get: jest.fn(async () => null), set: jest.fn(async () => 'OK'), del: jest.fn(async () => 1) };
    faceService = {
      identify: jest.fn(async () => ({
        matched: true,
        employeeId: 'emp-1',
        confidence: 0.92,
        livenessScore: 0.95,
      })),
      verify: jest.fn(async () => ({
        match: true,
        confidence: 0.9,
        livenessScore: 0.9,
        livenessPassed: true,
      })),
      verifyLive: jest.fn(async () => ({
        match: true,
        confidence: 0.9,
        livenessScore: 0.9,
        livenessPassed: true,
        challengePassed: true,
        consistency: 0.95,
        framesValid: 4,
        framesTotal: 4,
        reasons: [],
      })),
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
      // WS emit endi fonda (javobni kutdirmaydi) — mikrotasklar tugashini kutamiz
      await new Promise((resolve) => setImmediate(resolve));
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

    it('atomik claim: bir vaqtdagi ikkinchi urinish event yozmaydi (SET NX null)', async () => {
      // getDebounce null (tez-yo'l o'tadi), lekin atomik claim (SET NX) null
      // qaytaradi — ya'ni boshqa parallel so'rov allaqachon egallagan.
      redis.set.mockResolvedValue(null);
      await expect(service.kioskRecognize(device, Buffer.from('frame'))).rejects.toMatchObject({
        code: ErrorCodes.DEBOUNCE,
      });
      expect(eventRepository.save).not.toHaveBeenCalled();
    });
  });

  describe("kiosk qo'lda rejim (identify → confirm)", () => {
    it('identify: xodim tanildi → pending saqlanadi, event YOZILMAYDI', async () => {
      const result = await service.kioskIdentify(device, Buffer.from('frame'));
      expect(result).toMatchObject({ recognized: true, pending: true });
      expect(eventRepository.save).not.toHaveBeenCalled();
      expect(redis.set).toHaveBeenCalledWith(
        'kiosk:manual:pending:dev-1',
        expect.any(String),
        'EX',
        expect.any(Number),
      );
    });

    it('identify: bazada topilmadi → pending YO‘Q, tanilmadi', async () => {
      faceService.identify.mockResolvedValue({ matched: false, reason: 'FACE_NOT_RECOGNIZED' });
      const result = await service.kioskIdentify(device, Buffer.from('frame'));
      expect(result).toEqual({ recognized: false, reason: 'FACE_NOT_RECOGNIZED' });
      expect(redis.set).not.toHaveBeenCalled();
    });

    it("confirm: pending bor → tanlangan yo'nalish bilan event yoziladi", async () => {
      redis.get.mockImplementation(async (key: string) =>
        key === 'kiosk:manual:pending:dev-1'
          ? JSON.stringify({
              employeeId: 'emp-1',
              confidence: 0.91,
              livenessScore: 0.93,
              snapshotUrl: 'http://minio/snap.jpg',
            })
          : null,
      );
      const result = await service.kioskConfirm(device, AttendanceEventType.CHECK_OUT);
      expect(result).toMatchObject({ recognized: true });
      expect(eventRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          type: AttendanceEventType.CHECK_OUT,
          confidence: 0.91,
          snapshotUrl: 'http://minio/snap.jpg',
        }),
      );
    });

    it('confirm: pending yo‘q (muddati tugagan) → xato, event yozilmaydi', async () => {
      await expect(service.kioskConfirm(device, AttendanceEventType.CHECK_IN)).rejects.toThrow();
      expect(eventRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('kiosk filial scope', () => {
    it("default: identify FAQAT qurilma filiali doirasida chaqiriladi", async () => {
      await service.kioskRecognize(device, Buffer.from('frame'));
      expect(faceService.identify).toHaveBeenCalledWith(expect.anything(), 'c1', 'b1');
      expect(employeeRepository.findOne).toHaveBeenCalledWith({
        where: expect.objectContaining({ companyId: 'c1', branchId: 'b1' }),
      });
    });

    it('allowCrossBranchAttendance=true: identify butun kompaniya doirasida', async () => {
      companyRepository.findOne.mockResolvedValue({
        id: 'c1',
        timezone: 'Asia/Tashkent',
        settings: { allowCrossBranchAttendance: true },
      });
      await service.kioskRecognize(device, Buffer.from('frame'));
      expect(faceService.identify).toHaveBeenCalledWith(expect.anything(), 'c1', null);
      const where = employeeRepository.findOne.mock.calls[0][0].where;
      expect(where.branchId).toBeUndefined();
      expect(where.companyId).toBe('c1');
    });

    it("boshqa filial xodimi (cross-branch o'chiq) → tanilmadi", async () => {
      // identify topdi, lekin xodim qurilma filialiga tegishli emas → lookup null
      employeeRepository.findOne.mockResolvedValue(null);
      const result = await service.kioskRecognize(device, Buffer.from('frame'));
      expect(result).toEqual({ recognized: false, reason: 'FACE_NOT_RECOGNIZED' });
      expect(eventRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('mobile geofence', () => {
    const user = { id: 'u1', username: 'emp1', role: UserRole.EMPLOYEE, companyId: 'c1' };

    it('geofence tashqarisida → OUT_OF_GEOFENCE (distance details bilan)', async () => {
      await expect(
        service.mobileCheck(user, [Buffer.from('selfie')], {
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
        service.mobileCheck(user, [Buffer.from('selfie')], {
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
      const result = await service.mobileCheck(user, [Buffer.from('selfie')], {
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

    const geo = {
      latitude: 41.311081,
      longitude: 69.240562,
      accuracy: 5,
      isMockLocation: false,
      type: AttendanceEventType.CHECK_IN,
    };
    const burst = [Buffer.from('f1'), Buffer.from('f2'), Buffer.from('f3'), Buffer.from('f4')];

    it('burst (4 kadr) → verifyLive chaqiriladi va event yaratiladi', async () => {
      const result = await service.mobileCheck(user, burst, geo);
      expect(result.ok).toBe(true);
      expect(faceService.verifyLive).toHaveBeenCalledWith(
        burst,
        [[0.1, 0.2]],
        'turn',
        0, // HTTP klient kadrlari allaqachon to'g'ri orientatsiyada
      );
      expect(faceService.verify).not.toHaveBeenCalled();
    });

    it('burst: LIVENESS_FAILED → xato + spoofAttempt audit yoziladi', async () => {
      faceService.verifyLive.mockResolvedValue({
        match: false,
        confidence: 0,
        livenessScore: 0.2,
        livenessPassed: false,
        challengePassed: false,
        consistency: 0.9,
        framesValid: 4,
        framesTotal: 4,
        errorCode: 'LIVENESS_FAILED',
        reasons: ['PASSIVE_ANTISPOOF_LOW'],
      });
      await expect(service.mobileCheck(user, burst, geo)).rejects.toMatchObject({
        code: 'LIVENESS_FAILED',
      });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'attendance.spoofAttempt' }),
      );
      expect(eventRepository.save).not.toHaveBeenCalled();
    });

    it('burst: CHALLENGE_FAILED → transient xato, event yozilmaydi', async () => {
      faceService.verifyLive.mockResolvedValue({
        match: false,
        confidence: 0,
        livenessScore: 0.9,
        livenessPassed: true,
        challengePassed: false,
        consistency: 0.9,
        framesValid: 4,
        framesTotal: 4,
        errorCode: 'CHALLENGE_FAILED',
        reasons: ['NO_HEAD_TURN'],
      });
      await expect(service.mobileCheck(user, burst, geo)).rejects.toMatchObject({
        code: 'CHALLENGE_FAILED',
      });
      expect(eventRepository.save).not.toHaveBeenCalled();
    });

    it('burst: kadrlarda yuz yo‘q → FACE_NOT_DETECTED', async () => {
      faceService.verifyLive.mockResolvedValue({
        match: false,
        confidence: 0,
        livenessScore: 0,
        livenessPassed: false,
        challengePassed: false,
        consistency: 0,
        framesValid: 0,
        framesTotal: 4,
        errorCode: 'FACE_NOT_FOUND',
        reasons: ['TOO_FEW_FRAMES_WITH_FACE'],
      });
      await expect(service.mobileCheck(user, burst, geo)).rejects.toMatchObject({
        code: 'FACE_NOT_DETECTED',
      });
    });

    it('bitta selfie (eski klient): liveness o‘tmasa LIVENESS_FAILED + audit', async () => {
      faceService.verify.mockResolvedValue({
        match: false,
        confidence: 0.9,
        livenessScore: 0.2,
        livenessPassed: false,
        errorCode: 'LIVENESS_FAILED',
      });
      await expect(
        service.mobileCheck(user, [Buffer.from('selfie')], geo),
      ).rejects.toMatchObject({ code: 'LIVENESS_FAILED' });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'attendance.spoofAttempt' }),
      );
    });

    it('debounce faol bo‘lsa → DEBOUNCE (429)', async () => {
      redis.get.mockResolvedValue(JSON.stringify({ eventId: 'evt-0' }));
      await expect(
        service.mobileCheck(user, [Buffer.from('selfie')], {
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
