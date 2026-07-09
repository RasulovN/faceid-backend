import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import { randomBytes } from 'crypto';

@Injectable()
export class MinioService implements OnModuleInit {
  private readonly logger = new Logger(MinioService.name);
  readonly client: Minio.Client;
  readonly employeesBucket: string;
  readonly snapshotsBucket: string;
  private readonly endpoint: string;
  private readonly port: number;
  private readonly useSSL: boolean;
  /** Brauzer uchun URL bazasi (masalan https://backend.timepro.uz/s3); bo'sh — endpoint:port */
  private readonly publicBase: string;

  constructor(private readonly config: ConfigService) {
    this.endpoint = this.config.getOrThrow<string>('MINIO_ENDPOINT');
    this.port = Number(this.config.getOrThrow('MINIO_PORT'));
    // Joi validatsiyasi qiymatni boolean'ga aylantiradi — string bilan solishtirish
    // production'da (true) doim false bergani uchun String() orqali normallashtiriladi
    this.useSSL = String(this.config.get('MINIO_USE_SSL')) === 'true';
    this.publicBase = (this.config.get<string>('MINIO_PUBLIC_URL') ?? '').trim().replace(/\/+$/, '');
    this.employeesBucket = this.config.getOrThrow<string>('MINIO_BUCKET_EMPLOYEES');
    this.snapshotsBucket = this.config.getOrThrow<string>('MINIO_BUCKET_SNAPSHOTS');
    this.client = new Minio.Client({
      endPoint: this.endpoint,
      port: this.port,
      useSSL: this.useSSL,
      accessKey: this.config.getOrThrow<string>('MINIO_ACCESS_KEY'),
      secretKey: this.config.getOrThrow<string>('MINIO_SECRET_KEY'),
    });
  }

  /** Bucketlar birinchi ishga tushishda avtomatik yaratiladi (public GET policy bilan) */
  async onModuleInit(): Promise<void> {
    for (const bucket of [this.employeesBucket, this.snapshotsBucket]) {
      try {
        const exists = await this.client.bucketExists(bucket);
        if (!exists) {
          await this.client.makeBucket(bucket);
          this.logger.log(`MinIO bucket yaratildi: ${bucket}`);
        }
        await this.client.setBucketPolicy(
          bucket,
          JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Principal: { AWS: ['*'] },
                Action: ['s3:GetObject'],
                Resource: [`arn:aws:s3:::${bucket}/*`],
              },
            ],
          }),
        );
      } catch (err) {
        this.logger.error(`MinIO bucket tayyorlashda xato (${bucket}): ${(err as Error).message}`);
      }
    }
  }

  /** Fayl yuklash → public URL qaytaradi */
  async upload(
    bucket: string,
    keyPrefix: string,
    buffer: Buffer,
    contentType: string,
    extension = 'jpg',
  ): Promise<string> {
    const key = `${keyPrefix}/${Date.now()}-${randomBytes(6).toString('hex')}.${extension}`;
    await this.client.putObject(bucket, key, buffer, buffer.length, {
      'Content-Type': contentType,
    });
    return this.publicUrl(bucket, key);
  }

  /** Aniq kalit bilan yuklash (masalan, embeddingId nomli xodim rasmi) */
  async uploadWithKey(
    bucket: string,
    key: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<string> {
    await this.client.putObject(bucket, key, buffer, buffer.length, {
      'Content-Type': contentType,
    });
    return this.publicUrl(bucket, key);
  }

  /**
   * Presigned PUT URL (klient to'g'ridan-to'g'ri yuklashi uchun).
   * MINIO_PUBLIC_URL berilgan bo'lsa host public bazaga almashtiriladi — imzo
   * buzilmaydi, chunki nginx /s3/ prefiksni kesib Host headerni MINIO_ENDPOINT'ga
   * qaytaradi (imzolangan canonical host/path MinIO'ga o'zgarishsiz yetadi).
   */
  async presignPut(bucket: string, key: string): Promise<string> {
    const expires = Number(this.config.getOrThrow('MINIO_PRESIGNED_EXPIRES'));
    const url = await this.client.presignedPutObject(bucket, key, expires);
    return this.publicBase ? url.replace(/^https?:\/\/[^/]+/, this.publicBase) : url;
  }

  publicUrl(bucket: string, key: string): string {
    if (this.publicBase) return `${this.publicBase}/${bucket}/${key}`;
    const proto = this.useSSL ? 'https' : 'http';
    return `${proto}://${this.endpoint}:${this.port}/${bucket}/${key}`;
  }

  async bucketExists(bucket: string): Promise<boolean> {
    try {
      return await this.client.bucketExists(bucket);
    } catch {
      return false;
    }
  }
}
