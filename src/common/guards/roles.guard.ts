import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppException } from '../exceptions/app.exception';
import { RequestUser, ROLES_KEY } from '../decorators';
import { UserRole } from '../enums';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const user = context.switchToHttp().getRequest().user as RequestUser | undefined;
    if (!user) return true; // public yoki device endpoint
    if (user.role === UserRole.SUPERADMIN) return true;
    if (!requiredRoles.includes(user.role)) {
      throw AppException.forbidden('Bu amal uchun rolingiz yetarli emas');
    }
    return true;
  }
}
