import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AttendanceEvent } from '../../entities/attendance-event.entity';
import { Branch } from '../../entities/branch.entity';
import { Company } from '../../entities/company.entity';
import { Device } from '../../entities/device.entity';
import { Employee } from '../../entities/employee.entity';
import { FaceEmbedding } from '../../entities/face-embedding.entity';
import { WorkDay } from '../../entities/work-day.entity';
import { DeviceTokenGuard } from '../../common/guards/device-token.guard';
import { WorkDaysModule } from '../workdays/workdays.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceExportService } from './attendance-export.service';
import { AttendanceService } from './attendance.service';
import { FaceCheckGateway } from './face-check.gateway';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AttendanceEvent,
      Employee,
      Branch,
      Company,
      Device,
      WorkDay,
      FaceEmbedding,
    ]),
    WorkDaysModule,
  ],
  controllers: [AttendanceController],
  providers: [AttendanceService, AttendanceExportService, DeviceTokenGuard, FaceCheckGateway],
  exports: [AttendanceService],
})
export class AttendanceModule {}
