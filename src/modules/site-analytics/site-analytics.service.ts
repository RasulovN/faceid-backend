import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { Repository } from 'typeorm';
import { SiteVisit } from '../../entities/site-visit.entity';
import { Paginated } from '../../common/dto/pagination.dto';
import { REDIS_CLIENT } from '../redis/redis.module';
import { GeoService } from './geo.service';
import { parseUserAgent } from './user-agent.util';
import { CreateVisitDto, VisitListQueryDto } from './dto/site-analytics.dtos';

/** Admin agregatlari 60s keshda — dashboard tez-tez yangilansa ham DB bezovta bo'lmaydi */
const CACHE_TTL_SECONDS = 60;
const CACHE_PREFIX = 'site-analytics:agg:';
/** Sessiya davomiyligining yuqori chegarasi (4 soat) — ochiq qolgan tablar shishirmasin */
const MAX_DURATION_SECONDS = 4 * 60 * 60;

@Injectable()
export class SiteAnalyticsService {
  private readonly logger = new Logger(SiteAnalyticsService.name);

  constructor(
    @InjectRepository(SiteVisit) private readonly visitRepository: Repository<SiteVisit>,
    private readonly geoService: GeoService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // ---------- Yozish (public) ----------

  /** Yangi tashrif: UA tahlili sinxron, geo — javobni kutdirmasdan asinxron */
  async recordVisit(dto: CreateVisitDto, ip: string, userAgent?: string): Promise<{ ok: true }> {
    const ua = parseUserAgent(userAgent);
    if (ua.isBot) return { ok: true }; // botlar statistikani buzmasin

    // Bitta sessiya — bitta yozuv (sahifa qayta yuklansa ham dublikat bo'lmaydi)
    const existing = await this.visitRepository.findOne({
      where: { sessionId: dto.sessionId },
      select: ['id'],
    });
    if (existing) return { ok: true };

    const visit = await this.visitRepository.save(
      this.visitRepository.create({
        visitorId: dto.visitorId,
        sessionId: dto.sessionId,
        ip: ip || 'nomalum',
        deviceType: ua.deviceType,
        os: ua.os,
        browser: ua.browser,
        referrer: dto.referrer?.slice(0, 512) ?? null,
        referrerHost: this.extractHost(dto.referrer),
        utmSource: dto.utmSource ?? null,
        utmMedium: dto.utmMedium ?? null,
        utmCampaign: dto.utmCampaign ?? null,
        path: dto.path.slice(0, 255),
        locale: dto.locale ?? null,
        screenWidth: dto.screenWidth ?? null,
        screenHeight: dto.screenHeight ?? null,
        isNewVisitor: dto.firstVisit === true,
      }),
    );

    // Geo lookup javobni sekinlashtirmasin — fon rejimida to'ldiriladi
    void this.applyGeo(visit.id, visit.ip);
    return { ok: true };
  }

  /** Heartbeat: davomiylik server soatidan hisoblanadi (mijoz hisobiga ishonilmaydi) */
  async recordHeartbeat(sessionId: string): Promise<{ ok: true }> {
    await this.visitRepository.query(
      `
      UPDATE "site_visits"
      SET "durationSeconds" = LEAST(
        GREATEST("durationSeconds", EXTRACT(EPOCH FROM now() - "createdAt")::int), $2)
      WHERE "sessionId" = $1
      `,
      [sessionId, MAX_DURATION_SECONDS],
    );
    return { ok: true };
  }

  private async applyGeo(visitId: string, ip: string): Promise<void> {
    try {
      const geo = await this.geoService.lookup(ip);
      if (!geo) return;
      await this.visitRepository.update(visitId, {
        country: geo.country,
        region: geo.region,
        city: geo.city,
      });
    } catch (err) {
      this.logger.warn(`Geo yozishda xato (${visitId}): ${(err as Error).message}`);
    }
  }

  private extractHost(referrer?: string): string | null {
    if (!referrer) return null;
    try {
      return new URL(referrer).hostname.replace(/^www\./, '').slice(0, 190) || null;
    } catch {
      return null;
    }
  }

  // ---------- O'qish (superadmin) ----------

  /** Yuqori kartalar: bugungi/haftalik/oylik tashriflar, unikal mehmonlar, o'rtacha davomiylik */
  async overview(days: number) {
    return this.cached(`overview:${days}`, async () => {
      const [row]: Array<Record<string, string | null>> = await this.visitRepository.query(
        `
        SELECT
          COUNT(*) FILTER (WHERE "createdAt" >= date_trunc('day', now()))          AS visits_today,
          COUNT(DISTINCT "visitorId") FILTER (WHERE "createdAt" >= date_trunc('day', now())) AS visitors_today,
          COUNT(*) FILTER (WHERE "createdAt" >= now() - interval '7 days')          AS visits_week,
          COUNT(*) FILTER (WHERE "createdAt" >= now() - make_interval(days => $1))  AS visits_period,
          COUNT(DISTINCT "visitorId") FILTER (WHERE "createdAt" >= now() - make_interval(days => $1)) AS visitors_period,
          ROUND(AVG("durationSeconds") FILTER (
            WHERE "durationSeconds" > 0 AND "createdAt" >= now() - make_interval(days => $1))) AS avg_duration,
          ROUND(100.0 * COUNT(*) FILTER (
            WHERE "isNewVisitor" AND "createdAt" >= now() - make_interval(days => $1))
            / GREATEST(COUNT(*) FILTER (WHERE "createdAt" >= now() - make_interval(days => $1)), 1)) AS new_share,
          (SELECT "country" FROM "site_visits"
            WHERE "country" IS NOT NULL AND "createdAt" >= now() - make_interval(days => $1)
            GROUP BY "country" ORDER BY COUNT(*) DESC LIMIT 1)                      AS top_country
        FROM "site_visits"
        `,
        [days],
      );
      return {
        visitsToday: Number(row.visits_today),
        visitorsToday: Number(row.visitors_today),
        visitsWeek: Number(row.visits_week),
        visitsPeriod: Number(row.visits_period),
        visitorsPeriod: Number(row.visitors_period),
        avgDurationSeconds: row.avg_duration == null ? 0 : Number(row.avg_duration),
        newVisitorPercent: Number(row.new_share),
        topCountry: row.top_country,
      };
    });
  }

  /** Kunlik seriya: tashriflar + unikal mehmonlar (chart) */
  async timeseries(days: number) {
    return this.cached(`timeseries:${days}`, async () => {
      const rows: Array<{ day: string; visits: string; visitors: string }> =
        await this.visitRepository.query(
          `
          SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
                 COALESCE(v.visits, 0)   AS visits,
                 COALESCE(v.visitors, 0) AS visitors
          FROM generate_series(
            date_trunc('day', now()) - make_interval(days => $1 - 1),
            date_trunc('day', now()), interval '1 day') AS d(day)
          LEFT JOIN (
            SELECT date_trunc('day', "createdAt") AS day,
                   COUNT(*) AS visits, COUNT(DISTINCT "visitorId") AS visitors
            FROM "site_visits"
            WHERE "createdAt" >= date_trunc('day', now()) - make_interval(days => $1 - 1)
            GROUP BY 1
          ) v ON v.day = d.day
          ORDER BY d.day
          `,
          [days],
        );
      return rows.map((r) => ({
        date: r.day,
        visits: Number(r.visits),
        visitors: Number(r.visitors),
      }));
    });
  }

  /** Soat kesimida taqsimot (0-23) — qaysi vaqtda ko'p kirilishini ko'rsatadi */
  async hours(days: number) {
    return this.cached(`hours:${days}`, async () => {
      const rows: Array<{ hour: string; visits: string }> = await this.visitRepository.query(
        `
        SELECT h.hour, COALESCE(v.visits, 0) AS visits
        FROM generate_series(0, 23) AS h(hour)
        LEFT JOIN (
          SELECT EXTRACT(HOUR FROM "createdAt")::int AS hour, COUNT(*) AS visits
          FROM "site_visits"
          WHERE "createdAt" >= now() - make_interval(days => $1)
          GROUP BY 1
        ) v ON v.hour = h.hour
        ORDER BY h.hour
        `,
        [days],
      );
      return rows.map((r) => ({ hour: Number(r.hour), visits: Number(r.visits) }));
    });
  }

  /** Hududlar: davlat va viloyat/shahar kesimida */
  async geo(days: number) {
    return this.cached(`geo:${days}`, async () => {
      const countries: Array<{ country: string | null; visits: string; visitors: string }> =
        await this.visitRepository.query(
          `
          SELECT "country", COUNT(*) AS visits, COUNT(DISTINCT "visitorId") AS visitors
          FROM "site_visits"
          WHERE "createdAt" >= now() - make_interval(days => $1)
          GROUP BY "country" ORDER BY visits DESC LIMIT 30
          `,
          [days],
        );
      const regions: Array<{
        country: string | null;
        region: string | null;
        city: string | null;
        visits: string;
      }> = await this.visitRepository.query(
        `
        SELECT "country", "region", "city", COUNT(*) AS visits
        FROM "site_visits"
        WHERE "createdAt" >= now() - make_interval(days => $1) AND "region" IS NOT NULL
        GROUP BY "country", "region", "city" ORDER BY visits DESC LIMIT 30
        `,
        [days],
      );
      const total = countries.reduce((sum, c) => sum + Number(c.visits), 0);
      return {
        countries: countries.map((c) => ({
          country: c.country,
          visits: Number(c.visits),
          visitors: Number(c.visitors),
          percent: total > 0 ? Math.round((Number(c.visits) / total) * 1000) / 10 : 0,
        })),
        regions: regions.map((r) => ({
          country: r.country,
          region: r.region,
          city: r.city,
          visits: Number(r.visits),
        })),
      };
    });
  }

  /** Trafik manbalari: referrer hostlar va UTM belgilar */
  async sources(days: number) {
    return this.cached(`sources:${days}`, async () => {
      const referrers: Array<{ host: string | null; visits: string }> =
        await this.visitRepository.query(
          `
          SELECT "referrerHost" AS host, COUNT(*) AS visits
          FROM "site_visits"
          WHERE "createdAt" >= now() - make_interval(days => $1)
          GROUP BY "referrerHost" ORDER BY visits DESC LIMIT 20
          `,
          [days],
        );
      const utm: Array<{ source: string; medium: string | null; campaign: string | null; visits: string }> =
        await this.visitRepository.query(
          `
          SELECT "utmSource" AS source, "utmMedium" AS medium, "utmCampaign" AS campaign, COUNT(*) AS visits
          FROM "site_visits"
          WHERE "createdAt" >= now() - make_interval(days => $1) AND "utmSource" IS NOT NULL
          GROUP BY 1, 2, 3 ORDER BY visits DESC LIMIT 20
          `,
          [days],
        );
      return {
        referrers: referrers.map((r) => ({ host: r.host, visits: Number(r.visits) })),
        utm: utm.map((u) => ({
          source: u.source,
          medium: u.medium,
          campaign: u.campaign,
          visits: Number(u.visits),
        })),
      };
    });
  }

  /** Qurilma / brauzer / OT / til taqsimotlari */
  async devices(days: number) {
    return this.cached(`devices:${days}`, async () => {
      const group = async (column: string) => {
        const rows: Array<{ name: string | null; visits: string }> =
          await this.visitRepository.query(
            `
            SELECT "${column}" AS name, COUNT(*) AS visits
            FROM "site_visits"
            WHERE "createdAt" >= now() - make_interval(days => $1)
            GROUP BY "${column}" ORDER BY visits DESC LIMIT 12
            `,
            [days],
          );
        return rows.map((r) => ({ name: r.name, visits: Number(r.visits) }));
      };
      return {
        deviceTypes: await group('deviceType'),
        browsers: await group('browser'),
        os: await group('os'),
        locales: await group('locale'),
      };
    });
  }

  /** So'nggi tashriflar jadvali — pagination + filtrlar (keshsiz, doim jonli) */
  async visits(query: VisitListQueryDto): Promise<Paginated<SiteVisit>> {
    const qb = this.visitRepository.createQueryBuilder('v');

    if (query.dateFrom) qb.andWhere('v.createdAt >= :from', { from: query.dateFrom });
    if (query.dateTo) qb.andWhere('v.createdAt <= :to', { to: query.dateTo });
    if (query.country) qb.andWhere('v.country = :country', { country: query.country });
    if (query.deviceType) qb.andWhere('v.deviceType = :device', { device: query.deviceType });
    if (query.search) {
      qb.andWhere(
        '(v.ip ILIKE :term OR v.city ILIKE :term OR v.region ILIKE :term OR v.referrerHost ILIKE :term)',
        { term: `%${query.search}%` },
      );
    }

    const sortBy = ['createdAt', 'durationSeconds', 'country'].includes(query.sortBy ?? '')
      ? query.sortBy!
      : 'createdAt';
    qb.orderBy(`v.${sortBy}`, query.sortOrder).skip(query.skip).take(query.limit);

    const [items, total] = await qb.getManyAndCount();
    return Paginated.of(items, total, query);
  }

  /** 365 kundan eski tashriflar tozalanadi (prune job chaqiradi) */
  async pruneOld(): Promise<number> {
    const result = await this.visitRepository.query(
      `DELETE FROM "site_visits" WHERE "createdAt" < now() - interval '365 days'`,
    );
    return Array.isArray(result) && result.length > 1 ? Number(result[1]) : 0;
  }

  private async cached<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const cacheKey = `${CACHE_PREFIX}${key}`;
    try {
      const hit = await this.redis.get(cacheKey);
      if (hit) return JSON.parse(hit) as T;
    } catch {
      /* Redis ishlamasa to'g'ridan-to'g'ri hisoblanadi */
    }
    const value = await loader();
    try {
      await this.redis.set(cacheKey, JSON.stringify(value), 'EX', CACHE_TTL_SECONDS);
    } catch {
      /* kesh yozilmasa ham javob qaytadi */
    }
    return value;
  }
}
