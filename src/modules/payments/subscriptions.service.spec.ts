import { SubscriptionsService } from './subscriptions.service';
import { PAYME_REASON_USER_CANCEL } from './payme.service';
import { PaymeState } from '../../common/enums';
import { AppException } from '../../common/exceptions/app.exception';
import { Payment } from '../../entities/payment.entity';

const PAY_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const COMPANY_ID = 'c1';

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: PAY_ID,
    companyId: COMPANY_ID,
    subscriptionId: null,
    tariffId: 'tariff-1',
    tariff: { id: 'tariff-1', name: 'Pro' },
    months: 1,
    amount: 49_900_000,
    provider: 'PAYME',
    paymeTransactionId: null,
    state: PaymeState.PENDING,
    paymeTime: null,
    performTime: null,
    cancelTime: null,
    reason: null,
    createdAt: new Date(),
    ...overrides,
  } as unknown as Payment;
}

describe("SubscriptionsService (to'lovni bekor qilish / qayta to'lash)", () => {
  let service: SubscriptionsService;
  let paymentRepository: { findOne: jest.Mock; update: jest.Mock };

  beforeEach(() => {
    paymentRepository = {
      findOne: jest.fn(),
      update: jest.fn(async () => ({ affected: 1 })),
    };
    const config = {
      get: jest.fn((key: string) =>
        key === 'CLIENT_URL' ? 'http://localhost:5173' : undefined,
      ),
    };
    const paymeConfig = {
      isConfigured: true,
      isLocalCheckout: true,
      merchantId: 'merchant-1',
      accountField: 'payment_id',
      checkoutUrl: 'http://localhost:5173/payme',
    };
    service = new SubscriptionsService(
      {} as any, // subscriptionRepository — bu testlarda ishlatilmaydi
      paymentRepository as any,
      {} as any, // tariffRepository
      {} as any, // companyRepository
      {} as any, // tariffLimits
      config as any,
      paymeConfig as any,
      { sendSubscriptionExtended: jest.fn(), sendSubscriptionCancelled: jest.fn() } as any, // mailService
      { create: jest.fn() } as any, // notificationsService
    );
  });

  // ---------- cancelPendingPayment ----------

  it('cancel: PENDING (tranzaksiyasiz) → CANCELLED, reason=USER_CANCEL', async () => {
    paymentRepository.findOne.mockResolvedValue(makePayment());
    const dto = await service.cancelPendingPayment(COMPANY_ID, PAY_ID);
    expect(dto.status).toBe('CANCELLED');
    expect(paymentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: PAY_ID, companyId: COMPANY_ID, state: PaymeState.PENDING }),
      expect.objectContaining({
        state: PaymeState.CANCELLED,
        reason: PAYME_REASON_USER_CANCEL,
      }),
    );
  });

  it('cancel: topilmasa → notFound', async () => {
    paymentRepository.findOne.mockResolvedValue(null);
    await expect(service.cancelPendingPayment(COMPANY_ID, PAY_ID)).rejects.toBeInstanceOf(
      AppException,
    );
  });

  it("cancel: to'langan to'lov bekor qilinmaydi", async () => {
    paymentRepository.findOne.mockResolvedValue(makePayment({ state: PaymeState.PERFORMED }));
    await expect(service.cancelPendingPayment(COMPANY_ID, PAY_ID)).rejects.toThrow(
      /amalga oshirilgan/,
    );
    expect(paymentRepository.update).not.toHaveBeenCalled();
  });

  it("cancel: Payme'da faol tranzaksiya bo'lsa bekor qilinmaydi", async () => {
    paymentRepository.findOne.mockResolvedValue(
      makePayment({ state: PaymeState.CREATED, paymeTransactionId: 'tx-1' }),
    );
    await expect(service.cancelPendingPayment(COMPANY_ID, PAY_ID)).rejects.toThrow(
      /faol tranzaksiya/,
    );
  });

  it('cancel: allaqachon bekor → idempotent (xatosiz DTO)', async () => {
    paymentRepository.findOne.mockResolvedValue(
      makePayment({ state: PaymeState.CANCELLED, reason: PAYME_REASON_USER_CANCEL }),
    );
    const dto = await service.cancelPendingPayment(COMPANY_ID, PAY_ID);
    expect(dto.status).toBe('CANCELLED');
    expect(paymentRepository.update).not.toHaveBeenCalled();
  });

  it("cancel: poyga — shartli UPDATE hech narsani o'zgartirmasa xato", async () => {
    paymentRepository.findOne.mockResolvedValue(makePayment());
    paymentRepository.update.mockResolvedValue({ affected: 0 });
    await expect(service.cancelPendingPayment(COMPANY_ID, PAY_ID)).rejects.toThrow(
      /holati o'zgarib/,
    );
  });

  // ---------- retryCheckout ----------

  it('retry: PENDING → xuddi shu payment uchun yangi checkout havolasi', async () => {
    paymentRepository.findOne.mockResolvedValue(makePayment());
    const res = await service.retryCheckout(COMPANY_ID, PAY_ID);
    expect(res.paymentId).toBe(PAY_ID);
    expect(res.amount).toBe(49_900_000);
    expect(res.checkoutUrl).toMatch(/^http:\/\/localhost:5173\/payme\//);
    const decoded = Buffer.from(res.checkoutUrl.split('/payme/')[1], 'base64').toString('utf8');
    expect(decoded).toContain(`ac.payment_id=${PAY_ID}`);
    expect(decoded).toContain('a=49900000');
    expect(decoded).toContain('m=merchant-1');
  });

  it("retry: to'langan to'lovga havola berilmaydi", async () => {
    paymentRepository.findOne.mockResolvedValue(makePayment({ state: PaymeState.PERFORMED }));
    await expect(service.retryCheckout(COMPANY_ID, PAY_ID)).rejects.toThrow(/allaqachon/);
  });

  it('retry: bekor qilingan to‘lov qayta ochilmaydi', async () => {
    paymentRepository.findOne.mockResolvedValue(makePayment({ state: PaymeState.CANCELLED }));
    await expect(service.retryCheckout(COMPANY_ID, PAY_ID)).rejects.toThrow(/Bekor qilingan/);
  });

  it('retry: CREATED (Payme faol tranzaksiya) → xato', async () => {
    paymentRepository.findOne.mockResolvedValue(
      makePayment({ state: PaymeState.CREATED, paymeTransactionId: 'tx-1' }),
    );
    await expect(service.retryCheckout(COMPANY_ID, PAY_ID)).rejects.toThrow(/faol tranzaksiya/);
  });
});

// ---------------------------------------------------------------------------
// adminManage (superadmin: uzaytirish / bekor qilish)
// ---------------------------------------------------------------------------

describe('SubscriptionsService.adminManage', () => {
  const SUB_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
  const DAY = 24 * 60 * 60 * 1000;

  let service: SubscriptionsService;
  let subscriptionRepository: { findOne: jest.Mock; save: jest.Mock };
  let companyRepository: { findOne: jest.Mock; update: jest.Mock };
  let notifications: { create: jest.Mock };
  let mail: { sendSubscriptionExtended: jest.Mock; sendSubscriptionCancelled: jest.Mock };

  function makeSub(overrides: Record<string, unknown> = {}) {
    return {
      id: SUB_ID,
      companyId: COMPANY_ID,
      tariffId: 'tariff-1',
      tariff: { id: 'tariff-1', name: 'Pro' },
      startsAt: new Date(Date.now() - 10 * DAY),
      endsAt: new Date(Date.now() + 20 * DAY),
      status: 'ACTIVE',
      isTrial: false,
      ...overrides,
    };
  }

  function makeCompany(overrides: Record<string, unknown> = {}) {
    return {
      id: COMPANY_ID,
      name: 'Demo',
      status: 'ACTIVE',
      ownerId: 'owner-1',
      contactEmail: 'owner@demo.uz',
      ...overrides,
    };
  }

  beforeEach(() => {
    subscriptionRepository = {
      findOne: jest.fn(),
      save: jest.fn(async (s: unknown) => s),
    };
    companyRepository = {
      findOne: jest.fn(async () => makeCompany()),
      update: jest.fn(async () => ({ affected: 1 })),
    };
    notifications = { create: jest.fn() };
    mail = { sendSubscriptionExtended: jest.fn(), sendSubscriptionCancelled: jest.fn() };
    service = new SubscriptionsService(
      subscriptionRepository as any,
      {} as any, // paymentRepository
      {} as any, // tariffRepository
      companyRepository as any,
      {} as any, // tariffLimits
      { get: jest.fn() } as any,
      {} as any, // paymeConfig
      mail as any,
      notifications as any,
    );
  });

  it('extend: faol obunada muddat MAVJUD endsAt ustiga qo‘shiladi', async () => {
    const sub = makeSub();
    const oldEnd = (sub.endsAt as Date).getTime();
    subscriptionRepository.findOne.mockResolvedValue(sub);

    const row = await service.adminManage(SUB_ID, 'extend', { days: 10 });

    expect(new Date(row.endsAt).getTime()).toBe(oldEnd + 10 * DAY);
    expect(row.status).toBe('ACTIVE');
    expect(companyRepository.update).toHaveBeenCalledWith(
      { id: COMPANY_ID },
      expect.objectContaining({ status: 'ACTIVE', subscriptionEndsAt: row.endsAt }),
    );
    expect(notifications.create).toHaveBeenCalledWith(
      'owner-1',
      'SUBSCRIPTION_EXTENDED',
      expect.any(String),
      expect.any(String),
      expect.any(Object),
    );
    expect(mail.sendSubscriptionExtended).toHaveBeenCalled();
  });

  it('extend: tugagan obunada muddat BUGUNDAN boshlanadi va status ACTIVE ga qaytadi', async () => {
    const sub = makeSub({ status: 'EXPIRED', endsAt: new Date(Date.now() - 5 * DAY) });
    subscriptionRepository.findOne.mockResolvedValue(sub);

    const before = Date.now();
    const row = await service.adminManage(SUB_ID, 'extend', { days: 30 });

    const endsAt = new Date(row.endsAt).getTime();
    expect(endsAt).toBeGreaterThanOrEqual(before + 30 * DAY - 1000);
    expect(endsAt).toBeLessThanOrEqual(Date.now() + 30 * DAY + 1000);
    expect(row.status).toBe('ACTIVE');
  });

  it('extend: months kalendar oy bo‘yicha qo‘shiladi', async () => {
    const end = new Date('2026-01-31T00:00:00Z');
    const sub = makeSub({ endsAt: new Date(Date.now() + 20 * DAY) });
    void end;
    subscriptionRepository.findOne.mockResolvedValue(sub);
    const base = (sub.endsAt as Date).getTime();

    const row = await service.adminManage(SUB_ID, 'extend', { months: 1 });
    // kalendar oy: aniq ms emas, lekin 28-31 kun oralig'ida
    const added = new Date(row.endsAt).getTime() - base;
    expect(added).toBeGreaterThanOrEqual(28 * DAY);
    expect(added).toBeLessThanOrEqual(31 * DAY);
  });

  it('extend: muddat berilmasa validation xatosi', async () => {
    subscriptionRepository.findOne.mockResolvedValue(makeSub());
    await expect(service.adminManage(SUB_ID, 'extend', {})).rejects.toThrow(AppException);
  });

  it('cancel: boshqa faol obuna bo‘lmasa kompaniya EXPIRED bo‘ladi', async () => {
    const sub = makeSub();
    // 1-chaqiruv: obunani topish; 2-chaqiruv: qolgan faol obuna qidiruvi → yo'q
    subscriptionRepository.findOne.mockResolvedValueOnce(sub).mockResolvedValueOnce(null);

    const row = await service.adminManage(SUB_ID, 'cancel');

    expect(row.status).toBe('CANCELLED');
    expect(companyRepository.update).toHaveBeenCalledWith(
      { id: COMPANY_ID },
      expect.objectContaining({ status: 'EXPIRED' }),
    );
    expect(notifications.create).toHaveBeenCalledWith(
      'owner-1',
      'SUBSCRIPTION_CANCELLED',
      expect.any(String),
      expect.any(String),
      expect.any(Object),
    );
    expect(mail.sendSubscriptionCancelled).toHaveBeenCalled();
  });

  it('cancel: qolgan faol obuna bo‘lsa kompaniya unga sinxronlanadi', async () => {
    const sub = makeSub();
    const other = makeSub({
      id: 'other-sub',
      tariffId: 'tariff-2',
      endsAt: new Date(Date.now() + 60 * DAY),
    });
    subscriptionRepository.findOne.mockResolvedValueOnce(sub).mockResolvedValueOnce(other);

    const row = await service.adminManage(SUB_ID, 'cancel');

    expect(row.status).toBe('CANCELLED');
    expect(companyRepository.update).toHaveBeenCalledWith(
      { id: COMPANY_ID },
      expect.objectContaining({ status: 'ACTIVE', tariffId: 'tariff-2' }),
    );
  });

  it('cancel: allaqachon bekor qilingan obuna → xato', async () => {
    subscriptionRepository.findOne.mockResolvedValue(makeSub({ status: 'CANCELLED' }));
    await expect(service.adminManage(SUB_ID, 'cancel')).rejects.toThrow(/allaqachon/);
  });

  it('topilmagan obuna → notFound', async () => {
    subscriptionRepository.findOne.mockResolvedValue(null);
    await expect(service.adminManage(SUB_ID, 'extend', { days: 1 })).rejects.toThrow(/topilmadi/);
  });
});
