import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength } from 'class-validator';
import { randomBytes } from 'crypto';
import { Permissions, CurrentUser, RequestUser } from '../../common/decorators';
import { PERMISSIONS } from '../../common/constants/permissions';
import { MinioService } from './minio.service';

/** Ruxsat etilgan rasm turlari — bucketlar public GET, shu sabab HTML/JS
 *  yuklab, ishonchli domenda saqlangan XSS'ni oldini olish uchun cheklaymiz. */
const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

class PresignDto {
  @IsIn(['employees', 'snapshots'])
  bucket: 'employees' | 'snapshots';

  @IsString()
  @MaxLength(255)
  fileName: string;

  @IsIn(ALLOWED_CONTENT_TYPES)
  contentType: (typeof ALLOWED_CONTENT_TYPES)[number];
}

@ApiTags('files')
@ApiBearerAuth()
@Controller('files')
export class FilesController {
  constructor(private readonly minioService: MinioService) {}

  @Post('presign')
  @Permissions(PERMISSIONS.FILES_PRESIGN)
  @ApiOperation({ summary: 'MinIO presigned PUT URL olish' })
  async presign(@Body() dto: PresignDto, @CurrentUser() user: RequestUser) {
    const bucket =
      dto.bucket === 'employees' ? this.minioService.employeesBucket : this.minioService.snapshotsBucket;
    const safeName = dto.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `${user.companyId ?? 'global'}/${Date.now()}-${randomBytes(4).toString('hex')}-${safeName}`;
    const uploadUrl = await this.minioService.presignPut(bucket, key);
    return { uploadUrl, fileUrl: this.minioService.publicUrl(bucket, key) };
  }
}
