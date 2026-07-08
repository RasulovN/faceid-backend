import { PaymeSubscribeService } from './payme-subscribe.service';
import { PaymeState } from '../../common/enums';
import { AppException } from '../../common/exceptions/app.exception';

const PAY_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function makePayment(overrides: Record<string, unknown> = {}) {
  return {
    id: PAY_ID,
    companyId: 'c1',
    tariffId: 't1',
    months: 3,
    amount: 59_700_000,
    state: PaymeState.PENDING,
    paymeTransactionId: null,
    ...overrides,
  };
}

describe('PaymeSubscribeService (tizim ichidagi karta to‘lovi)', () => {
  let service: PaymeSubscribeService;
  let paymentRepository: { findOne: jest.Mock };
  let tariffRepository: { findOne: jest.Mock };
  let paymeService: { buildFiscalDetail: jest.Mock };
  let fetchMock: jest.Mock;
  const originalFetch = global.fetch;

  const rpcOk = (result: Record<string, unknown>) =>
    ({ status: 200, json: async () => ({ result }) }) as unknown as Response;
  const rpcErr = (code: number, message: unknown) =>
    ({ status: 200, json: async () => ({ error: { code, message } }) }) as unknown as Response;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    paymentRepository = { findOne: jest.fn(async () => makePayment()) };
    tariffRepository = { findOne: jest.fn(async () => ({ id: 't1', name: 'Pro' })) };
    paymeService = {
      buildFiscalDetail: jest.fn(async () => ({ receipt_type: 0, items: [{ title: 'x' }] })),
    };
    const paymeConfig = {
      isConfigured: true,
      accountField: 'order_id',
      subscribeMerchantId: 'mid',
      subscribeKey: 'skey',
      subscribeApiUrl: 'https://checkout.test.paycom.uz/api',
    };
    service = new PaymeSubscribeService(
      paymentRepository as any,
      tariffRepository as any,
      paymeService as any,
      paymeConfig as any,
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function calledMethod(index: number): { method: string; params: any; headers: any } {
    const [, opts] = fetchMock.mock.calls[index];
    const body = JSON.parse(opts.body);
    return { method: body.method, params: body.params, headers: opts.headers };
  }

  it('chargeCard: cards.create (X-Auth faqat merchant_id) + get_verify_code', async () => {
    fetchMock.mockResolvedValueOnce(rpcOk({ card: { token: 'tok-1' } }));
    fetchMock.mockResolvedValueOnce(rpcOk({ sent: true, phone: '99890*****45', wait: 60000 }));

    const res = await service.chargeCard('c1', PAY_ID, '8600 4954 7331 6478', '03/99');
    expect(res).toEqual({ token: 'tok-1', phone: '99890*****45', wait: 60000 });

    const create = calledMethod(0);
    expect(create.method).toBe('cards.create');
    expect(create.params.card).toEqual({ number: '8600495473316478', expire: '0399' });
    expect(create.params.save).toBe(false);
    expect(create.headers['X-Auth']).toBe('mid'); // cards.* — kalitsiz
    expect(calledMethod(1).method).toBe('cards.get_verify_code');
  });

  it("chargeCard: karta format noto'g'ri → validation, Payme'ga so'rov ketmaydi", async () => {
    await expect(service.chargeCard('c1', PAY_ID, '1234', '03/99')).rejects.toBeInstanceOf(
      AppException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("chargeCard: to'langan payment → xato", async () => {
    paymentRepository.findOne.mockResolvedValue(makePayment({ state: PaymeState.PERFORMED }));
    await expect(
      service.chargeCard('c1', PAY_ID, '8600 4954 7331 6478', '03/99'),
    ).rejects.toThrow(/allaqachon/);
  });

  it('confirmAndPay: verify → receipts.create (mid:skey, account, detail) → pay → PAID', async () => {
    fetchMock
      .mockResolvedValueOnce(rpcOk({ card: { token: 'tok-verified' } })) // cards.verify
      .mockResolvedValueOnce(rpcOk({ receipt: { _id: 'r-1' } })) // receipts.create
      .mockResolvedValueOnce(rpcOk({ receipt: { _id: 'r-1', state: 4 } })); // receipts.pay
    paymentRepository.findOne
      .mockResolvedValueOnce(makePayment()) // loadPayablePayment
      .mockResolvedValueOnce(makePayment({ state: PaymeState.PERFORMED })); // waitForPaid

    const res = await service.confirmAndPay('c1', PAY_ID, 'tok-1', '666666');
    expect(res).toEqual({ status: 'PAID', receiptId: 'r-1' });

    expect(calledMethod(0).method).toBe('cards.verify');
    const create = calledMethod(1);
    expect(create.method).toBe('receipts.create');
    expect(create.headers['X-Auth']).toBe('mid:skey'); // receipts.* — kalit bilan
    expect(create.params.account).toEqual({ order_id: PAY_ID });
    expect(create.params.amount).toBe(59_700_000);
    expect(create.params.detail).toBeDefined(); // fiskal MXIK detail
    const pay = calledMethod(2);
    expect(pay.method).toBe('receipts.pay');
    expect(pay.params).toEqual({ id: 'r-1', token: 'tok-verified' });
  });

  it('confirmAndPay: receipts.pay xatosi → receipts.cancel + xato (uz xabari)', async () => {
    fetchMock
      .mockResolvedValueOnce(rpcOk({ card: { token: 'tok-verified' } }))
      .mockResolvedValueOnce(rpcOk({ receipt: { _id: 'r-1' } }))
      .mockResolvedValueOnce(rpcErr(-31630, { uz: "Kartada mablag' yetarli emas" }))
      .mockResolvedValueOnce(rpcOk({})); // receipts.cancel

    await expect(service.confirmAndPay('c1', PAY_ID, 'tok-1', '666666')).rejects.toThrow(
      /mablag/i,
    );
    const methods = fetchMock.mock.calls.map(
      (c: [string, { body: string }]) => JSON.parse(c[1].body).method,
    );
    expect(methods).toContain('receipts.cancel');
  });

  it('confirmAndPay: SMS kod xato (cards.verify error) → chek yaratilmaydi', async () => {
    fetchMock.mockResolvedValueOnce(rpcErr(-31103, 'Неверный код'));
    await expect(service.confirmAndPay('c1', PAY_ID, 'tok-1', '000000')).rejects.toThrow(
      /Неверный код/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('tarmoq xatosi → tushunarli validation xabari', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(
      service.chargeCard('c1', PAY_ID, '8600 4954 7331 6478', '03/99'),
    ).rejects.toThrow(/aloqa/);
  });
});
