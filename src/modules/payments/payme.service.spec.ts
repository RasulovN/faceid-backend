import { PaymeService, PaymeErrors, PAYME_TIMEOUT_MS } from './payme.service';
import { PaymeState, SubscriptionStatus } from '../../common/enums';
import { Payment } from '../../entities/payment.entity';

const MERCHANT_KEY = 'test_merchant_key';
const AUTH_OK = `Basic ${Buffer.from(`Paycom:${MERCHANT_KEY}`).toString('base64')}`;
const PAY_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: PAY_ID,
    companyId: 'c1',
    subscriptionId: null,
    tariffId: 'tariff-1',
    months: 1,
    amount: 49_900_000,
    paymeTransactionId: null,
    state: PaymeState.PENDING,
    paymeTime: null,
    performTime: null,
    cancelTime: null,
    reason: null,
    ...overrides,
  } as Payment;
}

const FISCAL = { mxik: '10305008002000000', packageCode: '1514296', vatPercent: 0 };

describe('PaymeService (state machine)', () => {
  let service: PaymeService;
  let paymentRepository: { findOne: jest.Mock; save: jest.Mock; createQueryBuilder: jest.Mock };
  let tariffRepository: { findOne: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let managerRepos: Record<string, any>;

  beforeEach(() => {
    paymentRepository = {
      findOne: jest.fn(),
      save: jest.fn(async (p: Payment) => p),
      createQueryBuilder: jest.fn(),
    };
    tariffRepository = {
      findOne: jest.fn(async () => ({ id: 'tariff-1', name: 'Pro' })),
    };
    managerRepos = {
      Payment: {
        findOne: jest.fn(),
        save: jest.fn(async (p: any) => p),
      },
      Subscription: {
        findOne: jest.fn(async () => null),
        save: jest.fn(async (s: any) => ({ ...s, id: 'sub-1' })),
        create: jest.fn((s: any) => s),
      },
      Company: { update: jest.fn() },
    };
    dataSource = {
      transaction: jest.fn(async (cb: (m: any) => Promise<unknown>) =>
        cb({
          getRepository: (entity: { name: string }) => managerRepos[entity.name],
        }),
      ),
    };
    const paymeConfig = {
      isTestMode: true,
      merchantId: 'merchant-1',
      merchantKey: MERCHANT_KEY,
      checkoutUrl: 'https://checkout.test.paycom.uz',
      accountField: 'payment_id',
      allowedIps: [] as string[],
      fiscal: FISCAL,
      isConfigured: true,
    };
    const companyRepository = {
      findOne: jest.fn(async () => ({
        id: 'c1',
        name: 'Demo LLC',
        ownerId: null,
        contactEmail: null,
      })),
    };
    const mailService = { sendPaymentSuccess: jest.fn(), sendPaymentRevoked: jest.fn() };
    const notificationsService = { create: jest.fn() };
    service = new PaymeService(
      paymentRepository as any,
      tariffRepository as any,
      companyRepository as any,
      dataSource as any,
      paymeConfig as any,
      mailService as any,
      notificationsService as any,
    );
  });

  function rpc(method: string, params: Record<string, unknown>, auth: string | undefined = AUTH_OK) {
    return service.handle({ id: 1, method, params }, auth);
  }

  // ---------- Auth ----------

  it('noto‘g‘ri Basic auth → -32504', async () => {
    const bad = `Basic ${Buffer.from('Paycom:notogri').toString('base64')}`;
    const response = await rpc('CheckPerformTransaction', {}, bad);
    expect(response.error?.code).toBe(PaymeErrors.INVALID_AUTH);
  });

  it('auth header yo‘q → -32504', async () => {
    const response = await service.handle(
      { id: 1, method: 'CheckPerformTransaction', params: {} },
      undefined,
    );
    expect(response.error?.code).toBe(PaymeErrors.INVALID_AUTH);
  });

  it('parol uzunligi boshqa bo‘lsa ham xavfsiz rad etiladi → -32504', async () => {
    const bad = `Basic ${Buffer.from('Paycom:x').toString('base64')}`;
    const response = await rpc('CheckPerformTransaction', {}, bad);
    expect(response.error?.code).toBe(PaymeErrors.INVALID_AUTH);
  });

  it('noma’lum metod → -32601', async () => {
    const response = await rpc('UnknownMethod', {});
    expect(response.error?.code).toBe(PaymeErrors.METHOD_NOT_FOUND);
  });

  // ---------- CheckPerformTransaction ----------

  it('CheckPerform: payment topilmasa → -31050', async () => {
    paymentRepository.findOne.mockResolvedValue(null);
    const response = await rpc('CheckPerformTransaction', {
      amount: 100,
      account: { payment_id: PAY_ID },
    });
    expect(response.error?.code).toBe(PaymeErrors.PAYMENT_NOT_FOUND);
  });

  it('CheckPerform: payment_id UUID bo‘lmasa → -31050 (DB’ga murojaatsiz)', async () => {
    const response = await rpc('CheckPerformTransaction', {
      amount: 100,
      account: { payment_id: 'notogri-id' },
    });
    expect(response.error?.code).toBe(PaymeErrors.PAYMENT_NOT_FOUND);
    expect(paymentRepository.findOne).not.toHaveBeenCalled();
  });

  it('CheckPerform: summa mos kelmasa → -31001', async () => {
    paymentRepository.findOne.mockResolvedValue(makePayment());
    const response = await rpc('CheckPerformTransaction', {
      amount: 1,
      account: { payment_id: PAY_ID },
    });
    expect(response.error?.code).toBe(PaymeErrors.INVALID_AMOUNT);
  });

  it('CheckPerform: hammasi joyida → allow + fiskal detail', async () => {
    paymentRepository.findOne.mockResolvedValue(makePayment());
    const response = await rpc('CheckPerformTransaction', {
      amount: 49_900_000,
      account: { payment_id: PAY_ID },
    });
    expect(response.result?.allow).toBe(true);
    const detail = response.result?.detail as any;
    expect(detail.receipt_type).toBe(0);
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0]).toMatchObject({
      price: 49_900_000,
      count: 1,
      code: FISCAL.mxik,
      package_code: FISCAL.packageCode,
      vat_percent: 0,
    });
    expect(detail.items[0].title).toContain('Pro');
  });

  it('CheckPerform: allaqachon to‘langan → -31051', async () => {
    paymentRepository.findOne.mockResolvedValue(makePayment({ state: PaymeState.PERFORMED }));
    const response = await rpc('CheckPerformTransaction', {
      amount: 49_900_000,
      account: { payment_id: PAY_ID },
    });
    expect(response.error?.code).toBe(PaymeErrors.ALREADY_PAID);
  });

  it('CheckPerform: bekor qilingan → -31052', async () => {
    paymentRepository.findOne.mockResolvedValue(makePayment({ state: PaymeState.CANCELLED }));
    const response = await rpc('CheckPerformTransaction', {
      amount: 49_900_000,
      account: { payment_id: PAY_ID },
    });
    expect(response.error?.code).toBe(PaymeErrors.CANCELLED_PAYMENT);
  });

  it('CheckPerform: faol tranzaksiya bor → -31008', async () => {
    paymentRepository.findOne.mockResolvedValue(makePayment({ state: PaymeState.CREATED }));
    const response = await rpc('CheckPerformTransaction', {
      amount: 49_900_000,
      account: { payment_id: PAY_ID },
    });
    expect(response.error?.code).toBe(PaymeErrors.CANNOT_PERFORM);
  });

  // ---------- CreateTransaction ----------

  it('CreateTransaction: yangi tranzaksiya → state 1 (qulf ostida)', async () => {
    const payment = makePayment();
    managerRepos.Payment.findOne.mockResolvedValue(payment);
    const response = await rpc('CreateTransaction', {
      id: 'payme-tx-1',
      time: 1751800000000,
      amount: 49_900_000,
      account: { payment_id: PAY_ID },
    });
    expect(response.result).toMatchObject({ transaction: PAY_ID, state: 1 });
    expect(payment.paymeTransactionId).toBe('payme-tx-1');
    expect(payment.state).toBe(PaymeState.CREATED);
    expect(dataSource.transaction).toHaveBeenCalled();
    expect(managerRepos.Payment.save).toHaveBeenCalled();
  });

  it('CreateTransaction: retry (bir xil id) → mavjud tranzaksiya qaytadi', async () => {
    const payment = makePayment({
      paymeTransactionId: 'payme-tx-1',
      state: PaymeState.CREATED,
      paymeTime: Date.now(),
    });
    managerRepos.Payment.findOne.mockResolvedValue(payment);
    const response = await rpc('CreateTransaction', {
      id: 'payme-tx-1',
      time: Date.now(),
      amount: 49_900_000,
      account: { payment_id: PAY_ID },
    });
    expect(response.result).toMatchObject({ transaction: PAY_ID, state: 1 });
    expect(managerRepos.Payment.save).not.toHaveBeenCalled();
  });

  it('CreateTransaction: boshqa faol tranzaksiya bor → -31008', async () => {
    managerRepos.Payment.findOne.mockResolvedValue(
      makePayment({ paymeTransactionId: 'payme-tx-1', state: PaymeState.CREATED, paymeTime: Date.now() }),
    );
    const response = await rpc('CreateTransaction', {
      id: 'payme-tx-2',
      time: Date.now(),
      amount: 49_900_000,
      account: { payment_id: PAY_ID },
    });
    expect(response.error?.code).toBe(PaymeErrors.CANNOT_PERFORM);
  });

  it('CreateTransaction: 12 soatdan eski tranzaksiya bekor qilinadi → -31008, reason 4', async () => {
    const payment = makePayment({
      paymeTransactionId: 'payme-tx-1',
      state: PaymeState.CREATED,
      paymeTime: Date.now() - PAYME_TIMEOUT_MS - 1000,
    });
    managerRepos.Payment.findOne.mockResolvedValue(payment);
    const response = await rpc('CreateTransaction', {
      id: 'payme-tx-1',
      time: Date.now(),
      amount: 49_900_000,
      account: { payment_id: PAY_ID },
    });
    expect(response.error?.code).toBe(PaymeErrors.CANNOT_PERFORM);
    expect(payment.state).toBe(PaymeState.CANCELLED);
    expect(payment.reason).toBe(4);
  });

  // ---------- PerformTransaction ----------

  it('PerformTransaction: state 1 → 2, obuna aktivlashadi', async () => {
    const payment = makePayment({
      paymeTransactionId: 'payme-tx-1',
      state: PaymeState.CREATED,
      paymeTime: Date.now(),
    });
    managerRepos.Payment.findOne.mockResolvedValue(payment);
    const response = await rpc('PerformTransaction', { id: 'payme-tx-1' });
    expect(response.result).toMatchObject({ transaction: PAY_ID, state: 2 });
    expect(payment.state).toBe(PaymeState.PERFORMED);
    expect(payment.performTime).toBeInstanceOf(Date);
    expect(payment.subscriptionId).toBe('sub-1');
    expect(managerRepos.Subscription.save).toHaveBeenCalled();
    expect(managerRepos.Company.update).toHaveBeenCalled();
  });

  it('PerformTransaction: takror chaqiruv idempotent', async () => {
    const performTime = new Date();
    managerRepos.Payment.findOne.mockResolvedValue(
      makePayment({ paymeTransactionId: 'payme-tx-1', state: PaymeState.PERFORMED, performTime }),
    );
    const response = await rpc('PerformTransaction', { id: 'payme-tx-1' });
    expect(response.result).toMatchObject({
      state: 2,
      perform_time: performTime.getTime(),
    });
    expect(managerRepos.Subscription.save).not.toHaveBeenCalled();
    expect(managerRepos.Payment.save).not.toHaveBeenCalled();
  });

  it('PerformTransaction: tranzaksiya topilmasa → -31003', async () => {
    managerRepos.Payment.findOne.mockResolvedValue(null);
    const response = await rpc('PerformTransaction', { id: 'yoq' });
    expect(response.error?.code).toBe(PaymeErrors.TRANSACTION_NOT_FOUND);
  });

  it('PerformTransaction: muddati o‘tgan → bekor + -31008', async () => {
    const payment = makePayment({
      paymeTransactionId: 'payme-tx-1',
      state: PaymeState.CREATED,
      paymeTime: Date.now() - PAYME_TIMEOUT_MS - 1000,
    });
    managerRepos.Payment.findOne.mockResolvedValue(payment);
    const response = await rpc('PerformTransaction', { id: 'payme-tx-1' });
    expect(response.error?.code).toBe(PaymeErrors.CANNOT_PERFORM);
    expect(payment.state).toBe(PaymeState.CANCELLED);
    expect(payment.reason).toBe(4);
  });

  // ---------- CancelTransaction ----------

  it('CancelTransaction: state 1 → -1', async () => {
    const payment = makePayment({
      paymeTransactionId: 'payme-tx-1',
      state: PaymeState.CREATED,
      paymeTime: Date.now(),
    });
    managerRepos.Payment.findOne.mockResolvedValue(payment);
    const response = await rpc('CancelTransaction', { id: 'payme-tx-1', reason: 3 });
    expect(response.result).toMatchObject({ transaction: PAY_ID, state: -1 });
    expect(payment.reason).toBe(3);
    expect(payment.cancelTime).toBeInstanceOf(Date);
  });

  it('CancelTransaction: state 2 → -2, obuna teskari qaytariladi', async () => {
    const startsAt = new Date('2026-01-01T00:00:00Z');
    const endsAt = new Date('2026-08-01T00:00:00Z');
    const subscription = {
      id: 'sub-1',
      companyId: 'c1',
      tariffId: 'tariff-1',
      startsAt,
      endsAt,
      status: SubscriptionStatus.ACTIVE,
      isTrial: false,
    };
    const payment = makePayment({
      paymeTransactionId: 'payme-tx-1',
      state: PaymeState.PERFORMED,
      performTime: new Date(),
      subscriptionId: 'sub-1',
      months: 1,
    });
    managerRepos.Payment.findOne.mockResolvedValue(payment);
    managerRepos.Subscription.findOne
      .mockResolvedValueOnce(subscription) // rollback uchun obunani topish
      .mockResolvedValueOnce(null); // boshqa faol obuna yo'q
    const response = await rpc('CancelTransaction', { id: 'payme-tx-1', reason: 5 });
    expect(response.result).toMatchObject({ state: -2 });
    // 1 oy ayirildi: 2026-08-01 → 2026-07-01
    expect(subscription.endsAt.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(managerRepos.Subscription.save).toHaveBeenCalled();
    expect(managerRepos.Company.update).toHaveBeenCalled();
  });

  it('CancelTransaction: allaqachon bekor → idempotent', async () => {
    const cancelTime = new Date();
    managerRepos.Payment.findOne.mockResolvedValue(
      makePayment({
        paymeTransactionId: 'payme-tx-1',
        state: PaymeState.CANCELLED,
        cancelTime,
        reason: 3,
      }),
    );
    const response = await rpc('CancelTransaction', { id: 'payme-tx-1', reason: 3 });
    expect(response.result).toMatchObject({ state: -1, cancel_time: cancelTime.getTime() });
    expect(managerRepos.Payment.save).not.toHaveBeenCalled();
  });

  // ---------- CheckTransaction ----------

  it('CheckTransaction: holat ma’lumotlarini qaytaradi', async () => {
    const performTime = new Date();
    paymentRepository.findOne.mockResolvedValue(
      makePayment({
        paymeTransactionId: 'payme-tx-1',
        state: PaymeState.PERFORMED,
        paymeTime: 1751800000000,
        performTime,
      }),
    );
    const response = await rpc('CheckTransaction', { id: 'payme-tx-1' });
    expect(response.result).toMatchObject({
      create_time: 1751800000000,
      perform_time: performTime.getTime(),
      cancel_time: 0,
      transaction: PAY_ID,
      state: 2,
    });
  });

  // ---------- GetStatement ----------

  it('GetStatement: davr ichidagi tranzaksiyalar ro‘yxati', async () => {
    const payment = makePayment({
      paymeTransactionId: 'payme-tx-1',
      state: PaymeState.PERFORMED,
      paymeTime: 1751800000000,
      performTime: new Date(1751800500000),
    });
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn(async () => [payment]),
    };
    paymentRepository.createQueryBuilder.mockReturnValue(qb);
    const response = await rpc('GetStatement', { from: 1751700000000, to: 1751900000000 });
    const transactions = response.result?.transactions as any[];
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      id: 'payme-tx-1',
      state: 2,
      amount: 49_900_000,
      account: { payment_id: PAY_ID },
    });
  });

  // ---------- Account maydoni (PAYME_ACCOUNT_FIELD) ----------

  it('account maydoni sozlanadigan: order_id bilan CheckPerform o‘tadi', async () => {
    (service as any).paymeConfig.accountField = 'order_id';
    paymentRepository.findOne.mockResolvedValue(makePayment());
    const response = await rpc('CheckPerformTransaction', {
      amount: 49_900_000,
      account: { order_id: PAY_ID },
    });
    expect(response.result?.allow).toBe(true);
  });

  it('account maydoni order_id bo‘lsa ham eski payment_id fallback ishlaydi', async () => {
    (service as any).paymeConfig.accountField = 'order_id';
    paymentRepository.findOne.mockResolvedValue(makePayment());
    const response = await rpc('CheckPerformTransaction', {
      amount: 49_900_000,
      account: { payment_id: PAY_ID },
    });
    expect(response.result?.allow).toBe(true);
  });

  // ---------- IP allowlist ----------

  it('IP allowlist: CIDR, aniq IP, IPv6-mapped va ichki chaqiruv', () => {
    (service as any).paymeConfig.allowedIps = ['185.234.113.0/27', '10.0.0.5'];
    expect(service.isIpAllowed('185.234.113.30')).toBe(true);
    expect(service.isIpAllowed('::ffff:185.234.113.5')).toBe(true);
    expect(service.isIpAllowed('10.0.0.5')).toBe(true);
    expect(service.isIpAllowed('185.234.114.1')).toBe(false);
    expect(service.isIpAllowed('8.8.8.8')).toBe(false);
    // ip undefined — ichki chaqiruv (sandbox) — o'tkaziladi
    expect(service.isIpAllowed(undefined)).toBe(true);
  });

  it('IP allowlist: ro‘yxat bo‘sh bo‘lsa hamma IP o‘tadi', () => {
    expect(service.isIpAllowed('8.8.8.8')).toBe(true);
  });

  it('IP allowlist: ruxsatsiz IP’dan so‘rov → -32504', async () => {
    (service as any).paymeConfig.allowedIps = ['185.234.113.0/27'];
    const response = await service.handle(
      { id: 1, method: 'CheckTransaction', params: {} },
      AUTH_OK,
      '1.2.3.4',
    );
    expect(response.error?.code).toBe(PaymeErrors.INVALID_AUTH);
  });
});
