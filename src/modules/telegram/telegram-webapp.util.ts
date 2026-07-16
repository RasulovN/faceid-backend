import { createHmac, timingSafeEqual } from 'crypto';

export interface TelegramWebAppUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface VerifiedInitData {
  ok: boolean;
  user?: TelegramWebAppUser;
  authDate?: number;
  reason?: string;
}

/**
 * Telegram Mini App `initData` imzosini tekshiradi (rasmiy spetsifikatsiya):
 * secret = HMAC_SHA256(bot_token, key="WebAppData");
 * hash == HMAC_SHA256(data_check_string, secret) bo'lishi shart.
 * Bu — Mini App'ning yagona autentifikatsiyasi: soxta initData bilan boshqa
 * ota-onaning ma'lumotini olish mumkin emas.
 */
export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 24 * 60 * 60,
): VerifiedInitData {
  if (!initData || !botToken) return { ok: false, reason: 'EMPTY' };

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { ok: false, reason: 'MALFORMED' };
  }
  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'NO_HASH' };

  const pairs: string[] = [];
  params.forEach((value, key) => {
    if (key !== 'hash') pairs.push(`${key}=${value}`);
  });
  const dataCheckString = pairs.sort().join('\n');

  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computed = createHmac('sha256', secret).update(dataCheckString).digest('hex');

  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'BAD_SIGNATURE' };
  }

  const authDate = Number(params.get('auth_date') ?? 0);
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSeconds) {
    return { ok: false, reason: 'EXPIRED' };
  }

  let user: TelegramWebAppUser | undefined;
  const rawUser = params.get('user');
  if (rawUser) {
    try {
      user = JSON.parse(rawUser) as TelegramWebAppUser;
    } catch {
      return { ok: false, reason: 'BAD_USER' };
    }
  }
  if (!user?.id) return { ok: false, reason: 'NO_USER' };

  return { ok: true, user, authDate };
}
