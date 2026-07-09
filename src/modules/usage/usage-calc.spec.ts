import {
  addDays,
  churnRisk,
  dayRange,
  diffDays,
  engagementLevel,
  engagementScore,
  growthPct,
  tashkentToday,
} from './usage-calc';

describe('usage-calc', () => {
  describe('tashkentToday', () => {
    it('UTC 19:01 dan keyin Toshkentda ertasi kun', () => {
      expect(tashkentToday(new Date('2026-07-08T19:01:00Z'))).toBe('2026-07-09');
    });

    it('UTC 18:59 da hali o‘sha kun', () => {
      expect(tashkentToday(new Date('2026-07-08T18:59:00Z'))).toBe('2026-07-08');
    });
  });

  describe('addDays / diffDays / dayRange', () => {
    it('oy chegarasidan o‘tadi', () => {
      expect(addDays('2026-06-30', 1)).toBe('2026-07-01');
      expect(addDays('2026-07-01', -1)).toBe('2026-06-30');
    });

    it('diffDays to‘g‘ri farq qaytaradi', () => {
      expect(diffDays('2026-07-09', '2026-07-01')).toBe(8);
      expect(diffDays('2026-07-01', '2026-07-01')).toBe(0);
    });

    it('dayRange inklyuziv ro‘yxat', () => {
      expect(dayRange('2026-06-29', '2026-07-01')).toEqual([
        '2026-06-29',
        '2026-06-30',
        '2026-07-01',
      ]);
    });
  });

  describe('growthPct', () => {
    it('prev=0: current bo‘lsa 100, bo‘lmasa 0', () => {
      expect(growthPct(5, 0)).toBe(100);
      expect(growthPct(0, 0)).toBe(0);
    });

    it('oddiy nisbat va pasayish', () => {
      expect(growthPct(150, 100)).toBe(50);
      expect(growthPct(50, 100)).toBe(-50);
    });
  });

  describe('engagementScore', () => {
    it('to‘liq faol kompaniya yuqori ball oladi', () => {
      const score = engagementScore({
        activeDays: 7,
        periodDays: 7,
        activeUsers: 5,
        totalUsers: 5,
        volume: 700, // kuniga 100 — hajm maksimumi
      });
      expect(score).toBeGreaterThanOrEqual(95);
    });

    it('umuman faolliksiz — 0', () => {
      expect(
        engagementScore({ activeDays: 0, periodDays: 7, activeUsers: 0, totalUsers: 5, volume: 0 }),
      ).toBe(0);
    });

    it('foydalanuvchisiz kompaniyada userRatio 0 (NaN emas)', () => {
      const score = engagementScore({
        activeDays: 3,
        periodDays: 7,
        activeUsers: 0,
        totalUsers: 0,
        volume: 30,
      });
      expect(Number.isFinite(score)).toBe(true);
      expect(score).toBeGreaterThan(0);
    });
  });

  describe('engagementLevel', () => {
    it('chegaralar: 60/30/1', () => {
      expect(engagementLevel(60)).toBe('high');
      expect(engagementLevel(59)).toBe('medium');
      expect(engagementLevel(30)).toBe('medium');
      expect(engagementLevel(29)).toBe('low');
      expect(engagementLevel(1)).toBe('low');
      expect(engagementLevel(0)).toBe('inactive');
    });
  });

  describe('churnRisk', () => {
    it('hech qachon faollik bo‘lmagan — none', () => {
      expect(churnRisk(null, 0, false)).toBe('none');
    });

    it('recency chegaralari: >14 high, >7 medium', () => {
      expect(churnRisk(15, 0, true)).toBe('high');
      expect(churnRisk(8, 0, true)).toBe('medium');
      expect(churnRisk(7, 0, true)).toBe('low');
    });

    it('keskin pasayish trendi xavfni oshiradi', () => {
      expect(churnRisk(0, -50, true)).toBe('high');
      expect(churnRisk(0, -25, true)).toBe('medium');
      expect(churnRisk(0, -24, true)).toBe('low');
    });

    it('davr ichida faolligi bo‘lmagan kompaniyada trend hisobga olinmaydi', () => {
      expect(churnRisk(3, -100, false)).toBe('low');
    });
  });
});
