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
