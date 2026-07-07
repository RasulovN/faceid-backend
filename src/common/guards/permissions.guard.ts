import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppException } from '../exceptions/app.exception';
import { PERMISSIONS_KEY, RequestUser } from '../decorators';
import { roleHasPermission } from '../constants/permissions';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const required = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest().user as RequestUser | undefined;
    if (!user) return true;
    const hasPermission = (p: string): boolean => {
      // Yangi token: effektiv permissionlar payloadda mavjud.
      if (user.permissions) {
        return user.permissions.includes('*') || user.permissions.includes(p);
      }
      // Eski token (roleId'siz) — enum rol fallback (backward-compat).
      return roleHasPermission(user.role, p);
    };
    const missing = required.filter((p) => !hasPermission(p));
    if (missing.length > 0) {
      throw AppException.forbidden(`Sizda quyidagi ruxsat(lar) yo‘q: ${missing.join(', ')}`);
    }
    return true;
  }
}
