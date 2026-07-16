import { GroupsService } from './groups.service';
import { Group } from '../../entities/group.entity';
import { Employee } from '../../entities/employee.entity';

const TZ = 'Asia/Tashkent'; // UTC+5

/** Tashkent vaqti bilan Date yasash: '2026-07-13', '14:05' → UTC Date */
function tashkent(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+05:00`);
}

function makeGroup(partial: Partial<Group>): Group {
  return {
    id: 'g1',
    companyId: 'c1',
    branchId: null,
    teacherId: null,
    name: 'Ingliz tili B2',
    days: [{ dayOfWeek: 1, startTime: '14:00', endTime: '16:00' }],
    gracePeriodMinutes: 10,
    absentAfterMinutes: 20,
    archived: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  } as Group;
}

function makeStudent(id: string, firstName: string, lastName: string): Employee {
  return {
    id,
    firstName,
    lastName,
    fullName: `${lastName} ${firstName}`,
    tabNumber: `S-${id}`,
    photoUrls: [],
    parentPhones: ['+998901234567'],
    status: 'ACTIVE',
    deletedAt: null,
  } as unknown as Employee;
}

describe('GroupsService.resolveCurrentLesson (kiosk: joriy darsni aniqlash)', () => {
  let service: GroupsService;
  let memberRepository: any;

  const groupA = makeGroup({ id: 'gA', name: 'A guruh' }); // Dush 14:00-16:00
  const groupB = makeGroup({
    id: 'gB',
    name: 'B guruh',
    days: [{ dayOfWeek: 1, startTime: '18:00', endTime: '20:00' }],
  });

  beforeEach(() => {
    memberRepository = {
      find: jest.fn(async () => [
        { groupId: 'gA', studentId: 's1', group: groupA },
        { groupId: 'gB', studentId: 's1', group: groupB },
      ]),
    };
    service = new GroupsService(
      {} as any, // groupRepository
      memberRepository,
      {} as any, // employeeRepository
      {} as any, // eventRepository
      {} as any, // branchRepository
      {} as any, // companyRepository
    );
  });

  // 2026-07-13 — dushanba
  it("dars boshlanib 5 daqiqa o'tganda → shu guruh, kechikish yo'q (grace ichida)", async () => {
    const lesson = await service.resolveCurrentLesson('s1', tashkent('2026-07-13', '14:05'), TZ);
    expect(lesson?.group.id).toBe('gA');
    expect(lesson?.minutesLate).toBe(0);
  });

  it('grace tugagach kelsa → minutesLate dars boshidan hisoblanadi', async () => {
    const lesson = await service.resolveCurrentLesson('s1', tashkent('2026-07-13', '14:20'), TZ);
    expect(lesson?.group.id).toBe('gA');
    expect(lesson?.minutesLate).toBe(20);
  });

  it("darsdan 50 daqiqa oldin kelish ham shu darsga yoziladi (60 daqiqalik oyna)", async () => {
    const lesson = await service.resolveCurrentLesson('s1', tashkent('2026-07-13', '13:10'), TZ);
    expect(lesson?.group.id).toBe('gA');
    expect(lesson?.minutesLate).toBe(0);
  });

  it('oynadan tashqarida (90 daqiqa oldin) → null', async () => {
    const lesson = await service.resolveCurrentLesson('s1', tashkent('2026-07-13', '12:30'), TZ);
    expect(lesson).toBeNull();
  });

  it('kechki payt → ikkinchi guruh darsi tanlanadi', async () => {
    const lesson = await service.resolveCurrentLesson('s1', tashkent('2026-07-13', '18:30'), TZ);
    expect(lesson?.group.id).toBe('gB');
  });

  it("boshqa kun (seshanba) → null", async () => {
    const lesson = await service.resolveCurrentLesson('s1', tashkent('2026-07-14', '14:05'), TZ);
    expect(lesson).toBeNull();
  });

  it('ikki dars oynasi kesishsa boshlanishiga eng yaqini tanlanadi', async () => {
    const groupC = makeGroup({
      id: 'gC',
      name: 'C guruh',
      days: [{ dayOfWeek: 1, startTime: '14:30', endTime: '16:30' }],
    });
    memberRepository.find.mockResolvedValue([
      { groupId: 'gA', studentId: 's1', group: groupA },
      { groupId: 'gC', studentId: 's1', group: groupC },
    ]);
    const lesson = await service.resolveCurrentLesson('s1', tashkent('2026-07-13', '14:25'), TZ);
    expect(lesson?.group.id).toBe('gC');
  });

  it('arxivlangan guruh hisobga olinmaydi', async () => {
    memberRepository.find.mockResolvedValue([
      { groupId: 'gA', studentId: 's1', group: makeGroup({ id: 'gA', archived: true }) },
    ]);
    const lesson = await service.resolveCurrentLesson('s1', tashkent('2026-07-13', '14:05'), TZ);
    expect(lesson).toBeNull();
  });
});

describe('GroupsService.journal (oylik davomat jurnali)', () => {
  let service: GroupsService;
  let groupRepository: any;
  let memberRepository: any;
  let eventRepository: any;
  let companyRepository: any;

  const group = makeGroup({}); // Dushanba 14:00-16:00, grace 10
  const s1 = makeStudent('s1', 'Ali', 'Valiyev');
  const s2 = makeStudent('s2', 'Vali', 'Aliyev');

  beforeEach(() => {
    // "Bugun" — 2026-07-16 (payshanba) 12:00 Tashkent
    jest.useFakeTimers({ now: tashkent('2026-07-16', '12:00') });
    groupRepository = { findOne: jest.fn(async () => group) };
    memberRepository = {
      find: jest.fn(async () => [{ student: s1 }, { student: s2 }]),
    };
    eventRepository = { find: jest.fn(async () => []) };
    companyRepository = { findOne: jest.fn(async () => ({ id: 'c1', timezone: TZ })) };
    service = new GroupsService(
      groupRepository,
      memberRepository,
      {} as any,
      eventRepository,
      {} as any,
      companyRepository,
    );
  });

  afterEach(() => jest.useRealTimers());

  it("2026-07 uchun dars kunlari — iyul dushanbalari (6, 13, 20, 27)", async () => {
    const journal = await service.journal('c1', 'g1', '2026-07');
    expect(journal.dates).toEqual(['2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27']);
  });

  it('guruhga bog‘langan event → PRESENT, oynadagi bog‘lanmagan kechikkan event → LATE', async () => {
    eventRepository.find.mockResolvedValue([
      // 06.07 14:05 — shu guruhga bog'langan, o'z vaqtida
      { employeeId: 's1', timestamp: tashkent('2026-07-06', '14:05'), groupId: 'g1', type: 'CHECK_IN' },
      // 13.07 14:30 — guruhga bog'lanmagan lekin oynada, grace'dan kech
      { employeeId: 's1', timestamp: tashkent('2026-07-13', '14:30'), groupId: null, type: 'CHECK_IN' },
    ]);
    const journal = await service.journal('c1', 'g1', '2026-07');
    const row = journal.students.find((s) => s.id === 's1')!;
    expect(row.marks['2026-07-06']).toBe('PRESENT');
    expect(row.marks['2026-07-13']).toBe('LATE');
    // Kelajakdagi darslar hali belgilanmaydi
    expect(row.marks['2026-07-20']).toBeNull();
    expect(row.marks['2026-07-27']).toBeNull();
    expect(row.summary).toEqual({ present: 1, late: 1, absent: 0 });
  });

  it('eventi yo‘q o‘quvchi: o‘tgan darslar ABSENT, kelajakdagilar null', async () => {
    const journal = await service.journal('c1', 'g1', '2026-07');
    const row = journal.students.find((s) => s.id === 's2')!;
    expect(row.marks['2026-07-06']).toBe('ABSENT');
    expect(row.marks['2026-07-13']).toBe('ABSENT');
    expect(row.marks['2026-07-20']).toBeNull();
    expect(row.summary).toEqual({ present: 0, late: 0, absent: 2 });
  });

  it('dars oynasidan tashqaridagi bog‘lanmagan event hisobga olinmaydi → ABSENT', async () => {
    eventRepository.find.mockResolvedValue([
      // 06.07 09:00 — ertalabki event, 14:00 darsga aloqasi yo'q
      { employeeId: 's2', timestamp: tashkent('2026-07-06', '09:00'), groupId: null, type: 'CHECK_IN' },
    ]);
    const journal = await service.journal('c1', 'g1', '2026-07');
    const row = journal.students.find((s) => s.id === 's2')!;
    expect(row.marks['2026-07-06']).toBe('ABSENT');
  });
});
