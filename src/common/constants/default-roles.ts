import { UserRole } from '../enums';
import { PERMISSIONS, Permission, ROLE_PERMISSIONS } from './permissions';

export interface DefaultRoleDef {
  name: string;
  description: string;
  permissions: Permission[];
}

/** Enum rol permissionlarini '*' siz Permission[] ko'rinishida oladi. */
function enumPermissions(role: UserRole): Permission[] {
  return ROLE_PERMISSIONS[role].filter((p): p is Permission => p !== '*');
}

/**
 * Har bir kompaniyaga backfill/seed qilinadigan default (isSystem) rollar.
 * Migration, seed va RolesService.seedDefaultRoles shu manbadan foydalanadi.
 */
export const DEFAULT_ROLES: readonly DefaultRoleDef[] = [
  {
    name: 'Administrator',
    description: 'Barcha ruxsatlar',
    permissions: Object.values(PERMISSIONS),
  },
  {
    name: 'HR menejer',
    description: 'Xodimlar, grafiklar va oylik boshqaruvi',
    permissions: enumPermissions(UserRole.HR),
  },
  {
    name: 'Filial menejeri',
    description: 'Filial davomatini boshqarish',
    permissions: enumPermissions(UserRole.BRANCH_MANAGER),
  },
];
