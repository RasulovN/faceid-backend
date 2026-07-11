import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';
import { DevicesService } from './devices.service';
import {
  CurrentDevice,
  CurrentUser,
  DeviceAuth,
  Permissions,
  Public,
  RequestUser,
  SkipAudit,
} from '../../common/decorators';
import { PERMISSIONS } from '../../common/constants/permissions';
import { DeviceDirection } from '../../common/enums';
import { Device } from '../../entities/device.entity';
import { DeviceTokenGuard } from '../../common/guards/device-token.guard';
import { PaginationDto } from '../../common/dto/pagination.dto';

class PairingCodeDto {
  @ApiProperty()
  @IsUUID()
  branchId: string;

  @ApiProperty({ example: 'Kirish kioski' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @ApiProperty({ enum: DeviceDirection })
  @IsIn(Object.values(DeviceDirection))
  direction: DeviceDirection;

  @ApiPropertyOptional({
    description:
      "Qo'lda rejim (faqat BOTH uchun): kioskda avval Kirish/Chiqish tugmasi bosiladi, keyin yuz skanerlanadi",
  })
  @IsOptional()
  @IsBoolean()
  manualMode?: boolean;
}

class PairDto {
  @ApiProperty({ example: '483920' })
  @IsString()
  @Length(6, 6)
  code: string;

  @ApiPropertyOptional({
    example: 'demo',
    description:
      "Kiosk URL'idagi kompaniya slug'i (/:companySlug/kiosk). Berilsa kod aynan shu kompaniyaga tegishli bo'lishi shart",
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  companySlug?: string;
}

class UpdateDeviceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional({ enum: DeviceDirection })
  @IsOptional()
  @IsIn(Object.values(DeviceDirection))
  direction?: DeviceDirection;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  manualMode?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

@ApiTags('devices')
@Controller('devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Get()
  @ApiBearerAuth()
  @Permissions(PERMISSIONS.DEVICES_READ)
  async findAll(@CurrentUser() user: RequestUser, @Query() query: PaginationDto) {
    return this.devicesService.findAll(user.companyId!, query);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @Permissions(PERMISSIONS.DEVICES_MANAGE)
  async update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDeviceDto,
  ) {
    return this.devicesService.update(user.companyId!, id, dto);
  }

  @Delete(':id')
  @ApiBearerAuth()
  @Permissions(PERMISSIONS.DEVICES_MANAGE)
  async remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.devicesService.remove(user.companyId!, id);
  }

  @Post('pairing-code')
  @ApiBearerAuth()
  @Permissions(PERMISSIONS.DEVICES_MANAGE)
  @ApiOperation({ summary: '6 xonali pairing kodi (Redis, 10 daqiqa TTL)' })
  async createPairingCode(@CurrentUser() user: RequestUser, @Body() dto: PairingCodeDto) {
    return this.devicesService.createPairingCode(user.companyId!, dto);
  }

  @Post('pair')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Kioskni kod bilan ulash → deviceToken' })
  async pair(@Body() dto: PairDto) {
    return this.devicesService.pair(dto.code, dto.companySlug);
  }

  @Post('heartbeat')
  @DeviceAuth()
  @UseGuards(DeviceTokenGuard)
  @SkipThrottle()
  @SkipAudit()
  @HttpCode(200)
  @ApiHeader({ name: 'X-Device-Token', required: true })
  @ApiOperation({ summary: 'Kiosk heartbeat (60s intervalda)' })
  async heartbeat(@CurrentDevice() device: Device) {
    return this.devicesService.heartbeat(device);
  }
}
