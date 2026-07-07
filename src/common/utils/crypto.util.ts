import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

let cachedKey: Buffer | null = null;

/**
 * AES-256-GCM kaliti mavjud JWT_ACCESS_SECRET'dan scrypt orqali derive qilinadi —
 * alohida env kaliti talab qilinmaydi.
 */
function getEncryptionKey(): Buffer {
  if (!cachedKey) {
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret) {
      throw new Error('JWT_ACCESS_SECRET aniqlanmagan — shifrlash kaliti derive qilib bo‘lmaydi');
    }
    cachedKey = scryptSync(secret, 'faceid:passport-encryption:v1', 32);
  }
  return cachedKey;
}

/** Testlar uchun keshni tozalash */
export function resetEncryptionKeyCache(): void {
  cachedKey = null;
}

/** AES-256-GCM: natija base64(iv[12] | authTag[16] | ciphertext) */
export function encryptString(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decryptString(payload: string): string {
  const raw = Buffer.from(payload, 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** Tasodifiy parol generatsiyasi (12 belgili) */
export function generatePassword(length = 12): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const special = '!@#$%';
  const all = upper + lower + digits + special;
  const pick = (set: string) => set[randomBytes(1)[0] % set.length];
  const chars = [pick(upper), pick(lower), pick(digits), pick(special)];
  while (chars.length < length) {
    chars.push(pick(all));
  }
  // Fisher–Yates aralashtirish
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/** Qurilma tokeni: 64 belgili hex */
export function generateDeviceToken(): string {
  return randomBytes(32).toString('hex');
}

/** 6 xonali pairing kodi */
export function generatePairingCode(): string {
  const n = randomBytes(4).readUInt32BE(0) % 1000000;
  return n.toString().padStart(6, '0');
}

/** URL uchun xavfsiz tasodifiy token */
export function generateUrlToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
