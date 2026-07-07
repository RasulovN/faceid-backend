import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { AppException } from '../exceptions/app.exception';
import { DEVICE_AUTH_KEY, IS_PUBLIC_KEY, RequestUser } from '../decorators';
import { UserRole } from '../enums';

export interface AccessTokenPayload {
  sub: string;
  username: string;
  role: UserRole;
  companyId: string | null;
  permissions?: string[];
  type: 'access';
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const isDeviceAuth = this.reflector.getAllAndOverride<boolean>(DEVICE_AUTH_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isDeviceAuth) return true; // DeviceTokenGuard tekshiradi

    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw AppException.unauthorized('Access token yuborilmagan');
    }
    const token = header.slice(7);
    let payload: AccessTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
        secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
    } catch {
      throw AppException.unauthorized('Access token yaroqsiz yoki muddati tugagan');
    }
    if (payload.type !== 'access') {
      throw AppException.unauthorized('Noto‘g‘ri token turi');
    }
    const user: RequestUser = {
      id: payload.sub,
      username: payload.username,
      role: payload.role,
      companyId: payload.companyId ?? null,
      permissions: payload.permissions,
    };
    req.user = user;
    return true;
  }
}
