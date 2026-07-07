import {
  createParamDecorator,
  CustomDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { UserRole } from '../enums';
import { Permission } from '../constants/permissions';
import { Device } from '../../entities/device.entity';

export const IS_PUBLIC_KEY = 'isPublic';
/** Endpoint JWT talab qilmaydi */
export const Public = (): CustomDecorator => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]): CustomDecorator => SetMetadata(ROLES_KEY, roles);

export const PERMISSIONS_KEY = 'permissions';
export const Permissions = (...permissions: Permission[]): CustomDecorator =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const DEVICE_AUTH_KEY = 'deviceAuth';
/** Endpoint X-Device-Token bilan himoyalanadi (JWT emas) */
export const DeviceAuth = (): CustomDecorator => SetMetadata(DEVICE_AUTH_KEY, true);

export const SKIP_ENVELOPE_KEY = 'skipEnvelope';
/** Javob envelope'ga o'ralmaydi (payme JSON-RPC, xlsx export) */
export const SkipEnvelope = (): CustomDecorator => SetMetadata(SKIP_ENVELOPE_KEY, true);

export const SKIP_AUDIT_KEY = 'skipAudit';
export const SkipAudit = (): CustomDecorator => SetMetadata(SKIP_AUDIT_KEY, true);

export const SKIP_SUBSCRIPTION_KEY = 'skipSubscriptionCheck';
/** Obuna tugagan bo'lsa ham ruxsat (to'lov/checkout endpointlari) */
export const SkipSubscriptionCheck = (): CustomDecorator => SetMetadata(SKIP_SUBSCRIPTION_KEY, true);

/** JWT'dan olingan foydalanuvchi ma'lumoti */
export interface RequestUser {
  id: string;
  username: string;
  role: UserRole;
  companyId: string | null;
  /**
   * Effektiv permissionlar (JWT payloadidan). `['*']` — cheksiz.
   * Eski (roleId'siz) tokenlarda undefined bo'lishi mumkin — bunda
   * PermissionsGuard enum rol fallbackiga o'tadi.
   */
  permissions?: string[];
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => {
    const req = ctx.switchToHttp().getRequest();
    return req.user as RequestUser;
  },
);

export const CurrentDevice = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Device => {
    const req = ctx.switchToHttp().getRequest();
    return req.device as Device;
  },
);
