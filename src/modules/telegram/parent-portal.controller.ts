import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public, SkipAudit } from '../../common/decorators';
import { ParentPortalOverviewDto } from './dto/parent-portal.dtos';
import { ParentPortalService } from './parent-portal.service';

/**
 * Telegram Mini App (ota-ona kabineti) — authsiz public endpoint.
 * Xavfsizlik: har so'rovda initData HMAC imzosi bot token bilan tekshiriladi.
 */
@ApiTags('parent-portal')
@Controller('public/parent-portal')
export class ParentPortalController {
  constructor(private readonly portalService: ParentPortalService) {}

  @Post('overview')
  @Public()
  @SkipAudit()
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Mini App: ota-onaning barcha o'quvchilari va oylik davomat statistikasi (initData auth)",
  })
  async overview(@Body() dto: ParentPortalOverviewDto) {
    return this.portalService.overview(dto.initData, dto.month);
  }
}
