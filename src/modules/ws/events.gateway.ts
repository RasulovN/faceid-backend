import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Server, Socket } from 'socket.io';
import { Branch } from '../../entities/branch.entity';
import { Device } from '../../entities/device.entity';
import { UserRole } from '../../common/enums';
import { AccessTokenPayload } from '../../common/guards/jwt-auth.guard';
import { WsService } from './ws.service';

interface SocketAuthData {
  userId?: string;
  companyId?: string | null;
  role?: UserRole;
  deviceId?: string;
}

@WebSocketGateway({ path: '/ws', cors: { origin: true, credentials: true } })
export class EventsGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(EventsGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly wsService: WsService,
    @InjectRepository(Device) private readonly deviceRepository: Repository<Device>,
    @InjectRepository(Branch) private readonly branchRepository: Repository<Branch>,
  ) {}

  afterInit(server: Server): void {
    this.wsService.setServer(server);
    this.logger.log('Socket.IO gateway tayyor (path: /ws)');
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const auth = (client.handshake.auth ?? {}) as { token?: string; deviceToken?: string };
      if (auth.token) {
        const payload = await this.jwtService.verifyAsync<AccessTokenPayload>(auth.token, {
          secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        });
        const data: SocketAuthData = {
          userId: payload.sub,
          companyId: payload.companyId,
          role: payload.role,
        };
        client.data = data;
        await client.join(`user:${payload.sub}`);
        if (payload.companyId) {
          await client.join(`company:${payload.companyId}`);
        }
        return;
      }
      if (auth.deviceToken) {
        const device = await this.deviceRepository.findOne({
          where: { deviceToken: auth.deviceToken },
        });
        if (!device || !device.isActive) {
          client.disconnect(true);
          return;
        }
        client.data = { deviceId: device.id, companyId: device.companyId } as SocketAuthData;
        await client.join(`device:${device.id}`);
        await client.join(`company:${device.companyId}`);
        await client.join(`branch:${device.branchId}`);
        return;
      }
      client.disconnect(true);
    } catch {
      client.disconnect(true);
    }
  }

  /** Panel klienti filial roomiga qo'shilishi mumkin (o'z kompaniyasi doirasida) */
  @SubscribeMessage('join:branch')
  async joinBranch(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { branchId?: string },
  ): Promise<{ ok: boolean }> {
    const data = client.data as SocketAuthData;
    if (!body?.branchId || !data?.companyId) return { ok: false };
    const branch = await this.branchRepository.findOne({
      where:
        data.role === UserRole.SUPERADMIN
          ? { id: body.branchId }
          : { id: body.branchId, companyId: data.companyId },
    });
    if (!branch) return { ok: false };
    await client.join(`branch:${branch.id}`);
    return { ok: true };
  }
}
