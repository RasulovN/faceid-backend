import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';

/**
 * Gateway o'rnatgan Socket.IO serveriga xabar yuborish uchun servis.
 * Boshqa modullar shu servis orqali event emit qiladi.
 */
@Injectable()
export class WsService {
  private readonly logger = new Logger(WsService.name);
  private server: Server | null = null;

  setServer(server: Server): void {
    this.server = server;
  }

  private emitTo(rooms: string[], event: string, payload: unknown): void {
    if (!this.server) return;
    for (const room of rooms) {
      this.server.to(room).emit(event, payload);
    }
  }

  /** attendance:new → company:{id} va branch:{id} roomlariga */
  emitAttendanceNew(companyId: string, branchId: string, payload: unknown): void {
    this.emitTo([`company:${companyId}`, `branch:${branchId}`], 'attendance:new', payload);
  }

  /** device:status → company:{id} */
  emitDeviceStatus(
    companyId: string,
    payload: {
      deviceId: string;
      isActive: boolean;
      lastSeenAt: Date | null;
      /** Faqat pairing (ulash) hodisasida: ulanishда ishlatilgan kod */
      code?: string;
      /** true — qurilma endi ulandi (pairing) */
      paired?: boolean;
      name?: string;
      branchId?: string;
    },
  ): void {
    this.emitTo([`company:${companyId}`], 'device:status', payload);
  }

  /** notification:new → user:{id} */
  emitNotification(userId: string, notification: unknown): void {
    this.emitTo([`user:${userId}`], 'notification:new', notification);
  }
}
