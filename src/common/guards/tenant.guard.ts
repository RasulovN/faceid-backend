import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppException } from '../exceptions/app.exception';
import { RequestUser } from '../decorators';
import { UserRole } from '../enums';

/**
 * Multi-tenancy: SUPERADMIN bo'lmagan har bir foydalanuvchi so'rovi
 * kompaniya scope'iga ega bo'lishi shart. Servislar req.companyId bilan filtrlaydi.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest();
    const user = req.user as RequestUser | undefined;
    if (!user) return true; // public / device endpointlar
    if (user.role === UserRole.SUPERADMIN) return true;
    if (!user.companyId) {
      throw AppException.forbidden('Hisobingiz hech qanday kompaniyaga bog‘lanmagan');
    }
    req.companyId = user.companyId;
    return true;
  }
}
