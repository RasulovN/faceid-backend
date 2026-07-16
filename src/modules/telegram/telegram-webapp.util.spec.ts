import { createHmac } from 'crypto';
import { verifyTelegramInitData } from './telegram-webapp.util';

const BOT_TOKEN = '123456:TEST-TOKEN';

/** Telegram spetsifikatsiyasi bo'yicha to'g'ri imzolangan initData yasaydi */
function signInitData(fields: Record<string, string>): string {
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) params.set(k, v);
  params.set('hash', hash);
  return params.toString();
}

describe('verifyTelegramInitData (Mini App autentifikatsiyasi)', () => {
  const user = JSON.stringify({ id: 987654321, first_name: 'Ota-ona' });
  const freshAuthDate = String(Math.floor(Date.now() / 1000) - 60);

  it("to'g'ri imzolangan initData qabul qilinadi, user chiqariladi", () => {
    const initData = signInitData({ auth_date: freshAuthDate, user, query_id: 'AAA' });
    const result = verifyTelegramInitData(initData, BOT_TOKEN);
    expect(result.ok).toBe(true);
    expect(result.user?.id).toBe(987654321);
  });

  it("buzilgan imzo rad etiladi (boshqa ota-ona ma'lumotini olish yo'li yopiq)", () => {
    const initData = signInitData({ auth_date: freshAuthDate, user });
    const tampered = initData.replace(
      encodeURIComponent(user),
      encodeURIComponent(JSON.stringify({ id: 111, first_name: 'Hacker' })),
    );
    expect(verifyTelegramInitData(tampered, BOT_TOKEN).ok).toBe(false);
  });

  it("boshqa bot tokeni bilan imzolangan initData rad etiladi", () => {
    const initData = signInitData({ auth_date: freshAuthDate, user });
    expect(verifyTelegramInitData(initData, 'boshqa:token').ok).toBe(false);
  });

  it('eskirgan auth_date (>24 soat) rad etiladi', () => {
    const old = String(Math.floor(Date.now() / 1000) - 25 * 60 * 60);
    const initData = signInitData({ auth_date: old, user });
    const result = verifyTelegramInitData(initData, BOT_TOKEN);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('EXPIRED');
  });

  it('hash yo‘q yoki bo‘sh initData rad etiladi', () => {
    expect(verifyTelegramInitData('', BOT_TOKEN).ok).toBe(false);
    expect(verifyTelegramInitData('auth_date=1&user=%7B%7D', BOT_TOKEN).ok).toBe(false);
  });

  it('user maydonisiz initData rad etiladi', () => {
    const initData = signInitData({ auth_date: freshAuthDate });
    const result = verifyTelegramInitData(initData, BOT_TOKEN);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('NO_USER');
  });
});
