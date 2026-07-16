import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AttendanceEvent } from '../../entities/attendance-event.entity';
import { Company } from '../../entities/company.entity';
import { Employee } from '../../entities/employee.entity';
import { GroupStudent } from '../../entities/group-student.entity';
import { TelegramContact } from '../../entities/telegram-contact.entity';
import { ParentPortalController } from './parent-portal.controller';
import { ParentPortalService } from './parent-portal.service';
import { TelegramService } from './telegram.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TelegramContact, Employee, Company, GroupStudent, AttendanceEvent]),
  ],
  controllers: [ParentPortalController],
  providers: [TelegramService, ParentPortalService],
  exports: [TelegramService],
})
export class TelegramModule {}
