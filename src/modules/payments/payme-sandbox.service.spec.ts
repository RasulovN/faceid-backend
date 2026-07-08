import {
  PaymeSandboxService,
  SANDBOX_CARD_INSUFFICIENT,
  SANDBOX_SMS_CODE,
} from './payme-sandbox.service';
import { PaymeErrors, PaymeResponse } from './payme.service';
import { PaymeState } from '../../common/enums';
import { AppException } from '../../common/exceptions/app.exception';

const PAY_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const MERCHANT_ID = 'sandbox-merchant';

/** checkout()dagi format bilan bir xil base64 parametrlar */
function checkoutParams(overrides: Record<string, string> = {}): string {
  const map: Record<string, string> = {
    m: MERCHANT_ID,
    'ac.payment_id': PAY_ID,
    a: '49900000',
    c: encodeURIComponent(`http://localhost:5173/app/subscription?paymentId=${PAY_ID}`),
    ct: '15000',
    l: 'uz',
    ...overrides,
  };
  const parts = Object.entries(map).map(([k, v]) => `${k}=${v}`);
  return Buffer.from(parts.join(';'), 'utf8').toString('base64');
}

describe('PaymeSandboxService (lokal checkout emulyatori)', () => {
  let service: PaymeSandboxService;
  let paymeService: { handle: jest.Mock };
  let paymentRepository: { findOne: jest.Mock };
  let tariffRepository: { findOne: jest.Mock };
  let companyRepository: { findOne: jest.Mock };
  let paymeConfig: {
    isLocalCheckout: boolean;
    merchantId: string;
    merchantKey: string;
    accountField: string;
    fiscal: unknown;
  };

  /** handle() javoblari metod bo'yicha */
  let rpcResults: Record<string, PaymeResponse>;

  beforeEach(() => {
    rpcResults = {
      CheckPerformTransaction: { id: 1, result: { allow: true } },
      CreateTransaction: { id: 1, result: { state: PaymeState.CREATED, transaction: PAY_ID } },
      PerformTransaction: {
        id: 1,
        result: { state: PaymeState.PERFORMED, transaction: PAY_ID, perform_time: 1000 },
      },
      SetFiscalData: { id: 1, result: { success: true } },
    };
    paymeService = {
      handle: jest.fn(async (req: { method: string }) => {
        return rpcResults[req.method] ?? { id: 1, error: { code: -32601, message: {} } };
      }),
    };
    paymentRepository = {
      findOne: jest.fn(async () => ({
        id: PAY_ID,
        companyId: 'c1',
        tariffId: 't1',
        months: 3,
        amount: 49_900_000,
        state: PaymeState.PENDING,
      })),
    };
    tariffRepository = { findOne: jest.fn(async () => ({ id: 't1', name: 'Pro' })) };
    companyRepository = { findOne: jest.fn(async () => ({ id: 'c1', name: 'Demo LLC' })) };
    paymeConfig = {
      isLocalCheckout: true,
      merchantId: MERCHANT_ID,
      merchantKey: 'sandbox_key',
      accountField: 'payment_id',
      fiscal: { mxik: '10305008002000000', packageCode: '', vatPercent: 0 },
    };
    service = new PaymeSandboxService(
      paymentRepository as any,
      tariffRepository as any,
      companyRepository as any,
      paymeService as any,
      paymeConfig as any,
    );
  });

  async function fullSessionToken(): Promise<string> {
    const info = await service.createSession(checkoutParams());
    return info.token!;
  }

  it("lokal checkout o'chiq bo'lsa → 404", async () => {
    paymeConfig.isLocalCheckout = false;
    await expect(service.createSession(checkoutParams())).rejects.toBeInstanceOf(AppException);
  });

  it("noto'g'ri merchant ID → xato", async () => {
    await expect(
      service.createSession(checkoutParams({ m: 'boshqa-kassa' })),
    ).rejects.toThrow(/merchant/i);
  });

  it("session: PENDING to'lov → token + ma'lumotlar", async () => {
    const info = await service.createSession(checkoutParams());
    expect(info.status).toBe('PENDING');
    expect(info.token).toHaveLength(32);
    expect(info.amount).toBe(49_900_000);
    expect(info.companyName).toBe('Demo LLC');
    expect(info.description).toContain('Pro');
    expect(info.callbackUrl).toContain('/app/subscription?paymentId=');
    // Rasmiy protokol chaqirilgan
    expect(paymeService.handle).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'CheckPerformTransaction' }),
      expect.stringMatching(/^Basic /),
    );
  });

  it("session: allaqachon to'langan → status PAID, token yo'q", async () => {
    rpcResults.CheckPerformTransaction = {
      id: 1,
      error: { code: PaymeErrors.ALREADY_PAID, message: { uz: 'x', ru: 'x', en: 'x' } },
    };
    const info = await service.createSession(checkoutParams());
    expect(info.status).toBe('PAID');
    expect(info.token).toBeNull();
  });

  it("card: noto'g'ri raqam rad etiladi", async () => {
    const token = await fullSessionToken();
    await expect(service.submitCard(token, '1234 5678 9012 3456', '03/99')).rejects.toThrow(
      /karta/i,
    );
  });

  it("card: muddati o'tgan karta rad etiladi", async () => {
    const token = await fullSessionToken();
    await expect(service.submitCard(token, '8600 4954 7331 6478', '01/20')).rejects.toThrow(
      /muddati/i,
    );
  });

  it('card: to\'g\'ri karta → maskalangan telefon + sandbox SMS kodi', async () => {
    const token = await fullSessionToken();
    const res = await service.submitCard(token, '8600 4954 7331 6478', '03/99');
    expect(res.smsCode).toBe(SANDBOX_SMS_CODE);
    expect(res.phone).toContain('+998');
  });

  it("confirm: noto'g'ri SMS kod → xato, to'lov bajarilmaydi", async () => {
    const token = await fullSessionToken();
    await service.submitCard(token, '8600 4954 7331 6478', '03/99');
    await expect(service.confirm(token, '000000')).rejects.toThrow(/SMS/i);
    expect(paymeService.handle).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: 'PerformTransaction' }),
      expect.anything(),
    );
  });

  it("confirm: 'mablag' yetarli emas' test kartasi → xato", async () => {
    const token = await fullSessionToken();
    await service.submitCard(token, SANDBOX_CARD_INSUFFICIENT, '03/99');
    await expect(service.confirm(token, SANDBOX_SMS_CODE)).rejects.toThrow(/mablag/i);
  });

  it("confirm: to'liq muvaffaqiyatli oqim → Create + Perform + fiskal", async () => {
    const token = await fullSessionToken();
    await service.submitCard(token, '8600 4954 7331 6478', '03/99');
    const result = await service.confirm(token, SANDBOX_SMS_CODE);

    expect(result.status).toBe('PAID');
    expect(result.callbackUrl).toContain('/app/subscription');
    const methods = paymeService.handle.mock.calls.map(
      (c: [{ method: string }, string]) => c[0].method,
    );
    expect(methods).toEqual(
      expect.arrayContaining([
        'CheckPerformTransaction',
        'CreateTransaction',
        'PerformTransaction',
        'SetFiscalData',
      ]),
    );
    // Sessiya bir marta ishlatiladi
    await expect(service.confirm(token, SANDBOX_SMS_CODE)).rejects.toThrow(/sessiya/i);
  });

  it('confirm: fiskal sozlanmagan bo\'lsa SetFiscalData chaqirilmaydi', async () => {
    paymeConfig.fiscal = null;
    const token = await fullSessionToken();
    await service.submitCard(token, '8600 4954 7331 6478', '03/99');
    await service.confirm(token, SANDBOX_SMS_CODE);
    const methods = paymeService.handle.mock.calls.map(
      (c: [{ method: string }, string]) => c[0].method,
    );
    expect(methods).not.toContain('SetFiscalData');
  });

  it('cancel: sessiya tozalanadi, callback qaytadi', async () => {
    const token = await fullSessionToken();
    const res = service.cancel(token);
    expect(res.callbackUrl).toContain('/app/subscription');
    await expect(service.submitCard(token, '8600 4954 7331 6478', '03/99')).rejects.toThrow(
      /sessiya/i,
    );
  });
});
