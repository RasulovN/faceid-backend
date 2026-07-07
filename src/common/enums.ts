export enum UserRole {
  SUPERADMIN = 'SUPERADMIN',
  COMPANY_OWNER = 'COMPANY_OWNER',
  COMPANY_ADMIN = 'COMPANY_ADMIN',
  BRANCH_MANAGER = 'BRANCH_MANAGER',
  HR = 'HR',
  EMPLOYEE = 'EMPLOYEE',
}

export enum CompanyStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  EXPIRED = 'EXPIRED',
}

export enum Gender {
  MALE = 'MALE',
  FEMALE = 'FEMALE',
}

export enum EmployeeStatus {
  ACTIVE = 'ACTIVE',
  VACATION = 'VACATION',
  FIRED = 'FIRED',
}

export enum SalaryType {
  FIXED = 'FIXED',
  HOURLY = 'HOURLY',
}

export enum ScheduleType {
  FIXED = 'FIXED',
  SHIFT = 'SHIFT',
  FLEXIBLE = 'FLEXIBLE',
}

export enum AttendanceEventType {
  CHECK_IN = 'CHECK_IN',
  CHECK_OUT = 'CHECK_OUT',
}

export enum AttendanceSource {
  KIOSK = 'KIOSK',
  MOBILE = 'MOBILE',
}

export enum WorkDayStatus {
  PRESENT = 'PRESENT',
  LATE = 'LATE',
  ABSENT = 'ABSENT',
  VACATION = 'VACATION',
  SICK = 'SICK',
}

export enum PenaltyType {
  LATE_FIXED = 'LATE_FIXED',
  LATE_PER_MINUTE = 'LATE_PER_MINUTE',
  /** Kechikkan har daqiqa uchun xodimning O'Z maoshidan proporsional (oylik/30/smena/60) ushlab qolinadi */
  LATE_SALARY = 'LATE_SALARY',
  /** Erta ketilgan har daqiqa uchun proporsional ushlab qolish (LATE_SALARY bilan simmetrik) */
  EARLY_LEAVE_SALARY = 'EARLY_LEAVE_SALARY',
  ABSENT = 'ABSENT',
  /** Sababsiz kelmagan har kun uchun xodimning bir kunlik ish haqi (oylik/30) ushlab qolinadi */
  ABSENT_SALARY = 'ABSENT_SALARY',
}

export enum BonusType {
  FULL_ATTENDANCE = 'FULL_ATTENDANCE',
  OVERTIME = 'OVERTIME',
}

export enum PayrollStatus {
  DRAFT = 'DRAFT',
  APPROVED = 'APPROVED',
  PAID = 'PAID',
}

/** Landing'dan kelgan murojaat (lead) bosqichlari — kanban ustunlari */
export enum LeadStatus {
  /** Yangi murojaat */
  NEW = 'NEW',
  /** Bog'lanildi */
  CONTACTED = 'CONTACTED',
  /** Demo ko'rsatildi */
  DEMO = 'DEMO',
  /** Tasdiqlangan (mijozga aylantirildi) — email yuboriladi */
  APPROVED = 'APPROVED',
  /** Rad etilgan — email yuboriladi */
  REJECTED = 'REJECTED',
}

/** Oylikka qo'lda kiritiladigan tuzatish turlari */
export enum PayrollAdjustmentType {
  /** Avans — oldindan berilgan pul, oylikdan ushlanadi */
  ADVANCE = 'ADVANCE',
  /** Qarz ushlanmasi */
  LOAN = 'LOAN',
  /** Boshqa ushlanma */
  DEDUCTION = 'DEDUCTION',
  /** Qo'shimcha mukofot (performance bonus va h.k.) */
  BONUS = 'BONUS',
}

export enum DeviceType {
  KIOSK = 'KIOSK',
}

export enum DeviceDirection {
  IN = 'IN',
  OUT = 'OUT',
  BOTH = 'BOTH',
}

export enum SubscriptionStatus {
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}

export enum PaymentProvider {
  PAYME = 'PAYME',
}

/** Payme tranzaksiya holatlari */
export enum PaymeState {
  PENDING = 0,
  CREATED = 1,
  PERFORMED = 2,
  CANCELLED = -1,
  CANCELLED_AFTER_PERFORM = -2,
}
