export { User } from './user.entity';
export { Role } from './role.entity';
export { Company } from './company.entity';
export { Tariff } from './tariff.entity';
export { Branch, WorkingHoursDay } from './branch.entity';
export { Employee } from './employee.entity';
export { FaceEmbedding } from './face-embedding.entity';
export { WorkSchedule, ScheduleDay } from './work-schedule.entity';
export { AttendanceEvent } from './attendance-event.entity';
export { WorkDay } from './work-day.entity';
export { PenaltyRule, BonusRule, OvertimeRule } from './rules.entities';
export { PayrollRecord } from './payroll-record.entity';
export { PayrollAdjustment } from './payroll-adjustment.entity';
export { Holiday } from './holiday.entity';
export { Lead } from './lead.entity';
export { Device } from './device.entity';
export { Subscription } from './subscription.entity';
export { Payment } from './payment.entity';
export { AuditLog } from './audit-log.entity';
export { Notification } from './notification.entity';
export { SiteSetting } from './site-setting.entity';
export { SiteVisit } from './site-visit.entity';
export { StorageSnapshot } from './storage-snapshot.entity';

import { AttendanceEvent } from './attendance-event.entity';
import { AuditLog } from './audit-log.entity';
import { Branch } from './branch.entity';
import { Holiday } from './holiday.entity';
import { Lead } from './lead.entity';
import { PayrollAdjustment } from './payroll-adjustment.entity';
import { Company } from './company.entity';
import { Device } from './device.entity';
import { Employee } from './employee.entity';
import { FaceEmbedding } from './face-embedding.entity';
import { Notification } from './notification.entity';
import { Payment } from './payment.entity';
import { PayrollRecord } from './payroll-record.entity';
import { BonusRule, OvertimeRule, PenaltyRule } from './rules.entities';
import { Subscription } from './subscription.entity';
import { Role } from './role.entity';
import { SiteSetting } from './site-setting.entity';
import { SiteVisit } from './site-visit.entity';
import { StorageSnapshot } from './storage-snapshot.entity';
import { Tariff } from './tariff.entity';
import { User } from './user.entity';
import { WorkDay } from './work-day.entity';
import { WorkSchedule } from './work-schedule.entity';

export const ALL_ENTITIES = [
  User,
  Role,
  Company,
  Tariff,
  Branch,
  Employee,
  FaceEmbedding,
  WorkSchedule,
  AttendanceEvent,
  WorkDay,
  PenaltyRule,
  BonusRule,
  OvertimeRule,
  PayrollRecord,
  PayrollAdjustment,
  Holiday,
  Lead,
  Device,
  Subscription,
  Payment,
  AuditLog,
  Notification,
  SiteSetting,
  SiteVisit,
  StorageSnapshot,
];
