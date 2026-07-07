import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import { UpdateSiteSettingsDto } from './dto/settings.dto';
import { Public, Roles, SkipSubscriptionCheck } from '../../common/decorators';
import { UserRole } from '../../common/enums';

@ApiTags('settings')
@Controller()
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('settings/public')
  @Public()
  @ApiOperation({ summary: 'Sayt aloqa + ijtimoiy tarmoq maʼlumotlari (landing uchun, public)' })
  async findPublic() {
    return this.settingsService.get();
  }

  // ---------- Superadmin ----------

  @Get('admin/settings')
  @Roles(UserRole.SUPERADMIN)
  @SkipSubscriptionCheck()
  @ApiBearerAuth()
  async get() {
    return this.settingsService.get();
  }

  @Patch('admin/settings')
  @Roles(UserRole.SUPERADMIN)
  @SkipSubscriptionCheck()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Sayt maʼlumotlarini yangilash' })
  async update(@Body() dto: UpdateSiteSettingsDto) {
    return this.settingsService.update(dto);
  }
}
