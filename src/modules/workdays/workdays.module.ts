import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AttendanceEvent } from '../../entities/attendance-event.entity';
import { Branch } from '../../entities/branch.entity';
import { Company } from '../../entities/company.entity';
import { Employee } from '../../entities/employee.entity';
import { Holiday } from '../../entities/holiday.entity';
import { WorkDay } from '../../entities/work-day.entity';
import { WorkSchedule } from '../../entities/work-schedule.entity';
import { WorkDayService } from './workday.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WorkDay,
      WorkSchedule,
      AttendanceEvent,
      Employee,
      Branch,
      Company,
      Holiday,
    ]),
  ],
  providers: [WorkDayService],
  exports: [WorkDayService],
})
export class WorkDaysModule {}
