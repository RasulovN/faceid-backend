import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Branch } from '../../entities/branch.entity';
import { Company } from '../../entities/company.entity';
import { Device } from '../../entities/device.entity';
import { DeviceTokenGuard } from '../../common/guards/device-token.guard';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';

@Module({
  imports: [TypeOrmModule.forFeature([Device, Branch, Company])],
  controllers: [DevicesController],
  providers: [DevicesService, DeviceTokenGuard],
  exports: [DevicesService],
})
export class DevicesModule {}
