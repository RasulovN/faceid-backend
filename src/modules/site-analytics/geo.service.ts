import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

export interface GeoInfo {
  country: string | null;
  region: string | null;
  city: string | null;
}

/** Bir IP uchun geo natija 7 kun keshda turadi (ip-api.com limiti: 45 so'rov/daq) */
const GEO_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const GEO_CACHE_PREFIX = 'site-analytics:geo:';
const LOOKUP_TIMEOUT_MS = 3500;

const PRIVATE_IP_RE =
  /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe80|0\.0\.0\.0)/i;

/**
 * IP → hudud (davlat/viloyat/shahar). Tashqi ip-api.com xizmatidan foydalanadi,
 * natija Redis'da keshlanadi. Xato/limitda null qaytaradi — tashrif yozuvi
 * geo'siz ham saqlanaveradi (keyingi tashrifda kesh to'ladi).
 */
@Injectable()
export class GeoService {
  private readonly logger = new Logger(GeoService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async lookup(ip: string): Promise<GeoInfo | null> {
    if (!ip) return null;
    if (PRIVATE_IP_RE.test(ip)) {
      return { country: 'Lokal tarmoq', region: null, city: null };
    }

    const cacheKey = `${GEO_CACHE_PREFIX}${ip}`;
    try {
      const hit = await this.redis.get(cacheKey);
      if (hit) return JSON.parse(hit) as GeoInfo;
    } catch {
      // Redis vaqtincha ishlamasa — to'g'ridan-to'g'ri so'raymiz
    }

    const info = await this.fetchGeo(ip);
    if (info) {
      try {
        await this.redis.set(cacheKey, JSON.stringify(info), 'EX', GEO_CACHE_TTL_SECONDS);
      } catch {
        /* kesh yozilmasa ham natija ishlatiladi */
      }
    }
    return info;
  }

  private async fetchGeo(ip: string): Promise<GeoInfo | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
    try {
      const res = await fetch(
        `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,regionName,city`,
        { signal: controller.signal },
      );
      if (!res.ok) return null;
      const data = (await res.json()) as {
        status: string;
        country?: string;
        regionName?: string;
        city?: string;
      };
      if (data.status !== 'success') return null;
      return {
        country: data.country ?? null,
        region: data.regionName ?? null,
        city: data.city ?? null,
      };
    } catch (err) {
      this.logger.warn(`Geo lookup xatosi (${ip}): ${(err as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
