import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { RequestUser } from '../../common/decorators';
import { UserRole } from '../../common/enums';
import { UsageTrackerService } from './usage-tracker.service';

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Har muvaffaqiyatli autentifikatsiyalangan so'rovni usage buferiga yozadi:
 * requests har doim, actions faqat yozuvchi metodlarda. Superadmin va
 * kompaniyasiz foydalanuvchilar (hamda device-token so'rovlari) hisoblanmaydi —
 * kiosk faolligi davomat skanlari orqali alohida agregatlanadi.
 * Login public endpoint bo'lgani uchun auth.service'da alohida qayd etiladi.
 */
@Injectable()
export class UsageTrackingInterceptor implements NestInterceptor {
  constructor(private readonly usageTracker: UsageTrackerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    const user = req.user as RequestUser | undefined;
    if (!user?.companyId || user.role === UserRole.SUPERADMIN) return next.handle();

    const companyId = user.companyId;
    const isWrite = WRITE_METHODS.has(String(req.method ?? '').toUpperCase());
    return next.handle().pipe(
      tap(() => {
        this.usageTracker.track(companyId, user.id, { requests: 1, actions: isWrite ? 1 : 0 });
      }),
    );
  }
}
