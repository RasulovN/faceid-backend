/**
 * Yengil User-Agent tahlili — tashqi kutubxonasiz (analitika uchun aniqlik yetarli).
 * Faqat asosiy toifalar kerak: qurilma turi, OT, brauzer va bot belgisi.
 */

export interface ParsedUserAgent {
  deviceType: 'DESKTOP' | 'MOBILE' | 'TABLET';
  os: string | null;
  browser: string | null;
  isBot: boolean;
}

const BOT_RE =
  /bot|crawler|spider|crawling|facebookexternalhit|whatsapp|telegrambot|slurp|bingpreview|headless|lighthouse|pingdom|uptime/i;

export function parseUserAgent(ua: string | undefined): ParsedUserAgent {
  const s = ua ?? '';
  if (!s || BOT_RE.test(s)) {
    return { deviceType: 'DESKTOP', os: null, browser: null, isBot: true };
  }

  const isTablet = /iPad|Tablet|PlayBook|Silk/i.test(s) || (/Android/i.test(s) && !/Mobile/i.test(s));
  const isMobile = !isTablet && /Mobi|iPhone|Android.*Mobile|Windows Phone/i.test(s);

  let os: string | null = null;
  if (/Windows NT/i.test(s)) os = 'Windows';
  else if (/iPhone|iPad|iPod/i.test(s)) os = 'iOS';
  else if (/Mac OS X/i.test(s)) os = 'macOS';
  else if (/Android/i.test(s)) os = 'Android';
  else if (/Linux/i.test(s)) os = 'Linux';

  // Tartib muhim: Edge/Opera UA'sida "Chrome" ham bor
  let browser: string | null = null;
  if (/Edg\//i.test(s)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(s)) browser = 'Opera';
  else if (/YaBrowser/i.test(s)) browser = 'Yandex';
  else if (/SamsungBrowser/i.test(s)) browser = 'Samsung Internet';
  else if (/Firefox\//i.test(s)) browser = 'Firefox';
  else if (/Chrome\//i.test(s)) browser = 'Chrome';
  else if (/Safari\//i.test(s)) browser = 'Safari';

  return {
    deviceType: isTablet ? 'TABLET' : isMobile ? 'MOBILE' : 'DESKTOP',
    os,
    browser,
    isBot: false,
  };
}
