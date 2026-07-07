import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Branch } from '../../entities/branch.entity';
import { Device } from '../../entities/device.entity';
import { EventsGateway } from './events.gateway';
import { WsService } from './ws.service';

@Global()
@Module({
  imports: [JwtModule.register({}), TypeOrmModule.forFeature([Device, Branch])],
  providers: [EventsGateway, WsService],
  exports: [WsService],
})
export class WsModule {}
