import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from '../../entities/notification.entity';
import { AppException } from '../../common/exceptions/app.exception';
import { Paginated, PaginationDto } from '../../common/dto/pagination.dto';
import { WsService } from '../ws/ws.service';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    private readonly wsService: WsService,
  ) {}

  /** Yaratish + WS orqali real-time yetkazish */
  async create(
    userId: string,
    type: string,
    title: string,
    body: string,
    meta: Record<string, unknown> | null = null,
  ): Promise<Notification> {
    const notification = await this.notificationRepository.save(
      this.notificationRepository.create({ userId, type, title, body, meta }),
    );
    this.wsService.emitNotification(userId, notification);
    return notification;
  }

  async findAll(userId: string, query: PaginationDto, unreadOnly: boolean) {
    const [items, total] = await this.notificationRepository.findAndCount({
      where: unreadOnly ? { userId, isRead: false } : { userId },
      order: { createdAt: 'DESC' },
      skip: query.skip,
      take: query.limit,
    });
    return Paginated.of(items, total, query);
  }

  async markRead(userId: string, id: string): Promise<Notification> {
    const notification = await this.notificationRepository.findOne({ where: { id, userId } });
    if (!notification) throw AppException.notFound('Bildirishnoma topilmadi');
    notification.isRead = true;
    return this.notificationRepository.save(notification);
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.notificationRepository.update(
      { userId, isRead: false },
      { isRead: true },
    );
    return { updated: result.affected ?? 0 };
  }
}
