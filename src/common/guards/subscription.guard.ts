import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppException } from '../exceptions/app.exception';
import { ErrorCodes } from '../constants/error-codes';
import { RequestUser, SKIP_SUBSCRIPTION_KEY } from '../decorators';
import { CompanyStatus, UserRole } from '../enums';

const READONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

interface CacheEntry {
  status: CompanyStatus;
  at: number;
}

/**
 * Kompaniya SUSPENDED/EXPIRED bo'lsa faqat o'qish (GET) mumkin,
 * yozish so'rovlari 402 SUBSCRIPTION_EXPIRED bilan rad etiladi.
 * PENDING (superadmin hali tasdiqlamagan) bo'lsa ham yozish bloklanadi (403 COMPANY_PENDING).
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs = 30_000;

  constructor(
    private readonly reflector: Reflector,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest();
    const user = req.user as RequestUser | undefined;
    if (!user || user.role === UserRole.SUPERADMIN || !user.companyId) return true;
    if (READONLY_METHODS.has(String(req.method).toUpperCase())) return true;

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_SUBSCRIPTION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const status = await this.getCompanyStatus(user.companyId);
    if (status === CompanyStatus.PENDING) {
      throw new AppException(
        ErrorCodes.COMPANY_PENDING,
        'Kompaniyangiz hali administrator tomonidan tasdiqlanmagan. Tasdiqlangach tizimdan to‘liq foydalana olasiz.',
        HttpStatus.FORBIDDEN,
      );
    }
    if (status === CompanyStatus.SUSPENDED || status === CompanyStatus.EXPIRED) {
      throw new AppException(
        ErrorCodes.SUBSCRIPTION_EXPIRED,
        'Obunangiz muddati tugagan yoki to‘xtatilgan. To‘lovni amalga oshiring — o‘qish rejimi ochiq qoladi.',
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
    return true;
  }

  private async getCompanyStatus(companyId: string): Promise<CompanyStatus | null> {
    const cached = this.cache.get(companyId);
    if (cached && Date.now() - cached.at < this.cacheTtlMs) return cached.status;
    const rows: { status: CompanyStatus }[] = await this.dataSource.query(
      `SELECT "status" FROM "companies" WHERE "id" = $1`,
      [companyId],
    );
    const status = rows[0]?.status ?? null;
    if (status) this.cache.set(companyId, { status, at: Date.now() });
    return status;
  }

  /** Kompaniya statusi o'zgarganda keshni tozalash uchun */
  invalidate(companyId: string): void {
    this.cache.delete(companyId);
  }
}
