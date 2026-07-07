import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { AuditService } from './audit.service';
import { RequestUser, SKIP_AUDIT_KEY } from '../../common/decorators';

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const SENSITIVE_KEYS = new Set([
  'password',
  'newpassword',
  'currentpassword',
  'passwordhash',
  'refreshtoken',
  'accesstoken',
  'token',
  'passportseries',
  'credentials',
]);

function sanitize(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : v;
  }
  return out;
}

/**
 * Mutatsion endpointlarda avtomatik audit yozadi.
 * action: `controller.method` (masalan: employees.create).
 * oldValue faqat update/delete'da — servis request'ga `auditOldValue` qo'ysa.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    const method = String(req.method ?? '').toUpperCase();
    if (!MUTATING_METHODS.has(method)) return next.handle();

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return next.handle();

    const controllerName = context
      .getClass()
      .name.replace(/Controller$/, '')
      .toLowerCase();
    const handlerName = context.getHandler().name;
    const user = req.user as RequestUser | undefined;

    return next.handle().pipe(
      tap((result: unknown) => {
        const resultObj = (result ?? {}) as Record<string, unknown>;
        const entityId =
          (req.params?.id as string | undefined) ??
          (typeof resultObj.id === 'string' ? resultObj.id : undefined);
        const isUpdateOrDelete = method === 'PATCH' || method === 'PUT' || method === 'DELETE';
        void this.auditService.log({
          userId: user?.id ?? null,
          companyId: user?.companyId ?? (req.device?.companyId as string | undefined) ?? null,
          action: `${controllerName}.${handlerName}`,
          entityType: controllerName,
          entityId: entityId ?? null,
          oldValue: isUpdateOrDelete
            ? ((req.auditOldValue as Record<string, unknown> | undefined) ?? null)
            : null,
          newValue: method === 'DELETE' ? null : sanitize(req.body),
          ip: req.ip ?? null,
          userAgent: (req.headers?.['user-agent'] as string | undefined) ?? null,
        });
      }),
    );
  }
}
