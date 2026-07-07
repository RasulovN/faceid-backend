import { Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { CurrentUser, RequestUser, SkipAudit } from '../../common/decorators';
import { PaginationDto } from '../../common/dto/pagination.dto';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Bildirishnomalar ro‘yxati (?unread=true — faqat o‘qilmaganlar)' })
  async findAll(
    @CurrentUser() user: RequestUser,
    @Query() query: PaginationDto,
    @Query('unread') unread?: string,
  ) {
    return this.notificationsService.findAll(user.id, query, unread === 'true' || unread === '');
  }

  @Patch(':id/read')
  @SkipAudit()
  @ApiOperation({ summary: 'Bildirishnomani o‘qilgan deb belgilash' })
  async markRead(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notificationsService.markRead(user.id, id);
  }

  @Patch('read-all')
  @SkipAudit()
  @ApiOperation({ summary: 'Barchasini o‘qilgan deb belgilash' })
  async markAllRead(@CurrentUser() user: RequestUser) {
    return this.notificationsService.markAllRead(user.id);
  }
}
