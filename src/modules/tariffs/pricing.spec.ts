import { Tariff } from '../../entities/tariff.entity';
import { computeMonthlyPrice } from './pricing';

function makeTariff(overrides: Partial<Tariff>): Tariff {
  return {
    id: 't1',
    name: 'Test',
    description: null,
    priceMonthly: 0,
    isCustom: false,
    basePrice: 0,
    pricePerBranch: 0,
    pricePerEmployee: 0,
    pricePerDevice: 0,
    maxBranches: 0,
    maxEmployees: 0,
    maxDevices: 0,
    historyRetentionDays: 365,
    features: [],
    isActive: true,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Tariff;
}

describe('computeMonthlyPrice', () => {
  it('oddiy tarif → priceMonthly qaytaradi (limits e\'tiborsiz)', () => {
    const tariff = makeTariff({ isCustom: false, priceMonthly: 499000 });
    expect(computeMonthlyPrice(tariff)).toBe(499000);
    expect(computeMonthlyPrice(tariff, { branches: 10, employees: 100, devices: 10 })).toBe(499000);
  });

  it('custom tarif → base + per-unit formula bo\'yicha hisoblaydi', () => {
    const tariff = makeTariff({
      isCustom: true,
      basePrice: 50000000, // 500 000 so'm
      pricePerBranch: 3000000, // 30 000 so'm
      pricePerEmployee: 150000, // 1 500 so'm
      pricePerDevice: 2000000, // 20 000 so'm
    });
    // 50000000 + 3*3000000 + 50*150000 + 3*2000000 = 50000000 + 9000000 + 7500000 + 6000000
    expect(computeMonthlyPrice(tariff, { branches: 3, employees: 50, devices: 3 })).toBe(72500000);
  });

  it('custom: miqdor kamaysa narx kamayadi, ko\'paysa oshadi', () => {
    const tariff = makeTariff({
      isCustom: true,
      basePrice: 0,
      pricePerBranch: 1000,
      pricePerEmployee: 100,
      pricePerDevice: 500,
    });
    const low = computeMonthlyPrice(tariff, { branches: 1, employees: 10, devices: 1 });
    const high = computeMonthlyPrice(tariff, { branches: 5, employees: 50, devices: 5 });
    expect(low).toBe(1000 + 1000 + 500); // 2500
    expect(high).toBe(5000 + 5000 + 2500); // 12500
    expect(high).toBeGreaterThan(low);
  });

  it('custom: limits berilmasa tarif MAKS chegaralari bo\'yicha hisoblaydi', () => {
    const tariff = makeTariff({
      isCustom: true,
      basePrice: 100,
      pricePerBranch: 10,
      pricePerEmployee: 1,
      pricePerDevice: 5,
      maxBranches: 2,
      maxEmployees: 20,
      maxDevices: 2,
    });
    // 100 + 2*10 + 20*1 + 2*5 = 150
    expect(computeMonthlyPrice(tariff)).toBe(150);
  });
});
