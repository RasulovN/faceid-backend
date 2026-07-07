import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TariffsService } from './tariffs.service';
import { CreateTariffDto, UpdateTariffDto } from './dto/tariff.dtos';
import { Public, Roles } from '../../common/decorators';
import { UserRole } from '../../common/enums';

@ApiTags('tariffs')
@Controller()
export class TariffsController {
  constructor(private readonly tariffsService: TariffsService) {}

  @Get('tariffs')
  @Public()
  @ApiOperation({ summary: 'Faol tariflar (landing uchun, public)' })
  async findPublic() {
    return this.tariffsService.findPublic();
  }

  // ---------- Superadmin CRUD ----------

  @Get('admin/tariffs')
  @Roles(UserRole.SUPERADMIN)
  @ApiBearerAuth()
  async findAll() {
    return this.tariffsService.findAll();
  }

  @Post('admin/tariffs')
  @Roles(UserRole.SUPERADMIN)
  @ApiBearerAuth()
  async create(@Body() dto: CreateTariffDto) {
    return this.tariffsService.create(dto);
  }

  @Get('admin/tariffs/:id')
  @Roles(UserRole.SUPERADMIN)
  @ApiBearerAuth()
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.tariffsService.findOne(id);
  }

  @Patch('admin/tariffs/:id')
  @Roles(UserRole.SUPERADMIN)
  @ApiBearerAuth()
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTariffDto) {
    return this.tariffsService.update(id, dto);
  }

  @Delete('admin/tariffs/:id')
  @Roles(UserRole.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Tarifni deaktivatsiya qilish' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.tariffsService.remove(id);
  }
}
