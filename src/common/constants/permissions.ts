import { UserRole } from '../enums';

/** Tizimda ishlatiladigan barcha permission kalitlari */
export const PERMISSIONS = {
  COMPANY_READ: 'company.read',
  COMPANY_UPDATE: 'company.update',
  BRANCHES_READ: 'branches.read',
  BRANCHES_CREATE: 'branches.create',
  BRANCHES_UPDATE: 'branches.update',
  BRANCHES_DELETE: 'branches.delete',
  EMPLOYEES_READ: 'employees.read',
  EMPLOYEES_CREATE: 'employees.create',
  EMPLOYEES_UPDATE: 'employees.update',
  EMPLOYEES_DELETE: 'employees.delete',
  SCHEDULES_READ: 'schedules.read',
  SCHEDULES_MANAGE: 'schedules.manage',
  ATTENDANCE_READ: 'attendance.read',
  ATTENDANCE_MANAGE: 'attendance.manage',
  ATTENDANCE_EXPORT: 'attendance.export',
  RULES_READ: 'rules.read',
  RULES_MANAGE: 'rules.manage',
  PAYROLL_READ: 'payroll.read',
  PAYROLL_GENERATE: 'payroll.generate',
  PAYROLL_APPROVE: 'payroll.approve',
  PAYROLL_EXPORT: 'payroll.export',
  DEVICES_READ: 'devices.read',
  DEVICES_MANAGE: 'devices.manage',
  SUBSCRIPTIONS_READ: 'subscriptions.read',
  SUBSCRIPTIONS_CHECKOUT: 'subscriptions.checkout',
  PAYMENTS_READ: 'payments.read',
  USERS_READ: 'users.read',
  USERS_MANAGE: 'users.manage',
  STATS_READ: 'stats.read',
  AUDIT_READ: 'audit.read',
  NOTIFICATIONS_READ: 'notifications.read',
  FILES_PRESIGN: 'files.presign',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const ALL_COMPANY_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

/** Rol → permission mapping (RBAC manbasi) */
export const ROLE_PERMISSIONS: Record<UserRole, readonly (Permission | '*')[]> = {
  [UserRole.SUPERADMIN]: ['*'],
  [UserRole.COMPANY_OWNER]: ALL_COMPANY_PERMISSIONS,
  [UserRole.COMPANY_ADMIN]: ALL_COMPANY_PERMISSIONS,
  [UserRole.BRANCH_MANAGER]: [
    PERMISSIONS.COMPANY_READ,
    PERMISSIONS.BRANCHES_READ,
    PERMISSIONS.EMPLOYEES_READ,
    PERMISSIONS.SCHEDULES_READ,
    PERMISSIONS.ATTENDANCE_READ,
    PERMISSIONS.ATTENDANCE_MANAGE,
    PERMISSIONS.ATTENDANCE_EXPORT,
    PERMISSIONS.DEVICES_READ,
    PERMISSIONS.DEVICES_MANAGE,
    PERMISSIONS.STATS_READ,
    PERMISSIONS.NOTIFICATIONS_READ,
    PERMISSIONS.FILES_PRESIGN,
  ],
  [UserRole.HR]: [
    PERMISSIONS.COMPANY_READ,
    PERMISSIONS.BRANCHES_READ,
    PERMISSIONS.EMPLOYEES_READ,
    PERMISSIONS.EMPLOYEES_CREATE,
    PERMISSIONS.EMPLOYEES_UPDATE,
    PERMISSIONS.EMPLOYEES_DELETE,
    PERMISSIONS.SCHEDULES_READ,
    PERMISSIONS.SCHEDULES_MANAGE,
    PERMISSIONS.ATTENDANCE_READ,
    PERMISSIONS.ATTENDANCE_MANAGE,
    PERMISSIONS.ATTENDANCE_EXPORT,
    PERMISSIONS.RULES_READ,
    PERMISSIONS.RULES_MANAGE,
    PERMISSIONS.PAYROLL_READ,
    PERMISSIONS.PAYROLL_GENERATE,
    PERMISSIONS.PAYROLL_EXPORT,
    PERMISSIONS.STATS_READ,
    PERMISSIONS.NOTIFICATIONS_READ,
    PERMISSIONS.FILES_PRESIGN,
  ],
  [UserRole.EMPLOYEE]: [PERMISSIONS.NOTIFICATIONS_READ],
};

export function roleHasPermission(role: UserRole, permission: string): boolean {
  const granted = ROLE_PERMISSIONS[role] ?? [];
  return granted.includes('*') || granted.includes(permission as Permission);
}

/**
 * Foydalanuvchining EFFEKTIV ruxsati (PermissionsGuard bilan bir xil mantiq):
 * yangi tokenda payloaddagi `permissions` (custom rol) ustuvor; faqat eski
 * (roleId'siz) tokenda enum-rol jadvaliga tushamiz. Controller ichида qo'lda
 * tekshirilганda `roleHasPermission(user.role, ...)` ISHLATILMASIN — u custom
 * rol olib tashlagan ruxsatni ko'rmay, jadval bo'yicha ruxsat berib yuboradi.
 */
export function userHasPermission(
  user: { role: UserRole; permissions?: string[] | null },
  permission: string,
): boolean {
  if (user.permissions) {
    return user.permissions.includes('*') || user.permissions.includes(permission);
  }
  return roleHasPermission(user.role, permission);
}
