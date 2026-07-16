import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AttendanceEvent } from '../../entities/attendance-event.entity';
import { Branch } from '../../entities/branch.entity';
import { Company } from '../../entities/company.entity';
import { Employee } from '../../entities/employee.entity';
import { Group } from '../../entities/group.entity';
import { GroupStudent } from '../../entities/group-student.entity';
import { TelegramModule } from '../telegram/telegram.module';
import { EDUCATION_QUEUE, EducationProcessor } from './education.processor';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Group,
      GroupStudent,
      Employee,
      AttendanceEvent,
      Branch,
      Company,
    ]),
    BullModule.registerQueue({ name: EDUCATION_QUEUE }),
    TelegramModule,
  ],
  controllers: [GroupsController],
  providers: [GroupsService, EducationProcessor],
  exports: [GroupsService],
})
export class GroupsModule {}
