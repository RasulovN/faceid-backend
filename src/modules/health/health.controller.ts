import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import { Public, SkipAudit } from '../../common/decorators';
import { REDIS_CLIENT } from '../redis/redis.module';
import { FaceService } from '../face/face.service';
import { MinioService } from '../files/minio.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly faceService: FaceService,
    private readonly minioService: MinioService,
  ) {}

  @Get()
  @Public()
  @SkipAudit()
  @ApiOperation({ summary: 'Servis holati: DB, Redis, face-service, MinIO' })
  async check() {
    const [db, redis, faceService, minio] = await Promise.all([
      this.checkDb(),
      this.checkRedis(),
      this.faceService.health(),
      this.minioService.bucketExists(this.minioService.employeesBucket),
    ]);
    const allOk = db && redis && faceService && minio;
    return {
      status: allOk ? 'ok' : 'degraded',
      db: db ? 'ok' : 'down',
      redis: redis ? 'ok' : 'down',
      faceService: faceService ? 'ok' : 'down',
      minio: minio ? 'ok' : 'down',
    };
  }

  private async checkDb(): Promise<boolean> {
    try {
      await this.dataSource.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  private async checkRedis(): Promise<boolean> {
    try {
      return (await this.redis.ping()) === 'PONG';
    } catch {
      return false;
    }
  }
}
