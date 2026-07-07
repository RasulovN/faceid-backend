import { PERMISSIONS } from '../../common/constants/permissions';

export interface PermissionCatalogItem {
  key: string;
  label: string;
}

export interface PermissionGroup {
  group: string;
  items: PermissionCatalogItem[];
}

/**
 * Permission katalogi — UI da guruhlangan checkboxlar uchun.
 * Barcha kalitlar PERMISSIONS bilan mos; o'zbekcha labellar.
 */
export const PERMISSION_CATALOG: readonly PermissionGroup[] = [
  {
    group: 'Kompaniya',
    items: [
      { key: PERMISSIONS.COMPANY_READ, label: "Kompaniyani ko'rish" },
      { key: PERMISSIONS.COMPANY_UPDATE, label: 'Kompaniyani tahrirlash' },
    ],
  },
  {
    group: 'Filiallar',
    items: [
      { key: PERMISSIONS.BRANCHES_READ, label: "Filiallarni ko'rish" },
      { key: PERMISSIONS.BRANCHES_CREATE, label: "Filial qo'shish" },
      { key: PERMISSIONS.BRANCHES_UPDATE, label: 'Filialni tahrirlash' },
      { key: PERMISSIONS.BRANCHES_DELETE, label: "Filialni o'chirish" },
    ],
  },
  {
    group: 'Xodimlar',
    items: [
      { key: PERMISSIONS.EMPLOYEES_READ, label: "Xodimlarni ko'rish" },
      { key: PERMISSIONS.EMPLOYEES_CREATE, label: "Xodim qo'shish" },
      { key: PERMISSIONS.EMPLOYEES_UPDATE, label: 'Xodimni tahrirlash' },
      { key: PERMISSIONS.EMPLOYEES_DELETE, label: "Xodimni o'chirish" },
    ],
  },
  {
    group: 'Grafiklar',
    items: [
      { key: PERMISSIONS.SCHEDULES_READ, label: "Grafiklarni ko'rish" },
      { key: PERMISSIONS.SCHEDULES_MANAGE, label: 'Grafiklarni boshqarish' },
    ],
  },
  {
    group: 'Davomat',
    items: [
      { key: PERMISSIONS.ATTENDANCE_READ, label: "Davomatni ko'rish" },
      { key: PERMISSIONS.ATTENDANCE_MANAGE, label: 'Davomatni boshqarish' },
      { key: PERMISSIONS.ATTENDANCE_EXPORT, label: 'Davomatni eksport qilish' },
    ],
  },
  {
    group: 'Qoidalar',
    items: [
      { key: PERMISSIONS.RULES_READ, label: "Qoidalarni ko'rish" },
      { key: PERMISSIONS.RULES_MANAGE, label: 'Qoidalarni boshqarish' },
    ],
  },
  {
    group: 'Oylik',
    items: [
      { key: PERMISSIONS.PAYROLL_READ, label: "Oylikni ko'rish" },
      { key: PERMISSIONS.PAYROLL_GENERATE, label: 'Oylik hisoblash' },
      { key: PERMISSIONS.PAYROLL_APPROVE, label: 'Oylikni tasdiqlash' },
      { key: PERMISSIONS.PAYROLL_EXPORT, label: 'Oylikni eksport qilish' },
    ],
  },
  {
    group: 'Qurilmalar',
    items: [
      { key: PERMISSIONS.DEVICES_READ, label: "Qurilmalarni ko'rish" },
      { key: PERMISSIONS.DEVICES_MANAGE, label: 'Qurilmalarni boshqarish' },
    ],
  },
  {
    group: 'Obuna',
    items: [
      { key: PERMISSIONS.SUBSCRIPTIONS_READ, label: "Obunani ko'rish" },
      { key: PERMISSIONS.SUBSCRIPTIONS_CHECKOUT, label: "To'lov qilish" },
      { key: PERMISSIONS.PAYMENTS_READ, label: "To'lovlarni ko'rish" },
    ],
  },
  {
    group: 'Foydalanuvchilar',
    items: [
      { key: PERMISSIONS.USERS_READ, label: "Foydalanuvchilarni ko'rish" },
      { key: PERMISSIONS.USERS_MANAGE, label: 'Foydalanuvchilarni boshqarish' },
    ],
  },
  {
    group: 'Statistika',
    items: [{ key: PERMISSIONS.STATS_READ, label: "Statistikani ko'rish" }],
  },
  {
    group: 'Audit',
    items: [{ key: PERMISSIONS.AUDIT_READ, label: "Audit jurnalini ko'rish" }],
  },
  {
    group: 'Boshqa',
    items: [
      { key: PERMISSIONS.NOTIFICATIONS_READ, label: "Bildirishnomalarni ko'rish" },
      { key: PERMISSIONS.FILES_PRESIGN, label: 'Fayl yuklash' },
    ],
  },
];
