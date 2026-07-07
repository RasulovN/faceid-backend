import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '../../entities/company.entity';
import { Employee } from '../../entities/employee.entity';
import { Holiday } from '../../entities/holiday.entity';
import { PayrollAdjustment } from '../../entities/payroll-adjustment.entity';
import { PayrollRecord } from '../../entities/payroll-record.entity';
import { BonusRule, OvertimeRule, PenaltyRule } from '../../entities/rules.entities';
import { WorkDay } from '../../entities/work-day.entity';
import { WorkDaysModule } from '../workdays/workdays.module';
import { PayrollController } from './payroll.controller';
import { PayrollExportService } from './payroll-export.service';
import { PayrollProcessor, PAYROLL_QUEUE } from './payroll.processor';
import { PayrollService } from './payroll.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PayrollRecord,
      PayrollAdjustment,
      Employee,
      WorkDay,
      PenaltyRule,
      BonusRule,
      OvertimeRule,
      Company,
      Holiday,
    ]),
    BullModule.registerQueue({ name: PAYROLL_QUEUE }),
    WorkDaysModule,
  ],
  controllers: [PayrollController],
  providers: [PayrollService, PayrollExportService, PayrollProcessor],
  exports: [PayrollService],
})
export class PayrollModule {}
