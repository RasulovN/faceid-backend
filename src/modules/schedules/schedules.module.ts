import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Branch } from '../../entities/branch.entity';
import { Employee } from '../../entities/employee.entity';
import { Holiday } from '../../entities/holiday.entity';
import { WorkSchedule } from '../../entities/work-schedule.entity';
import { HolidaysController } from './holidays.controller';
import { SchedulesController } from './schedules.controller';
import { SchedulesService } from './schedules.service';

@Module({
  imports: [TypeOrmModule.forFeature([WorkSchedule, Branch, Employee, Holiday])],
  controllers: [SchedulesController, HolidaysController],
  providers: [SchedulesService],
  exports: [SchedulesService],
})
export class SchedulesModule {}
