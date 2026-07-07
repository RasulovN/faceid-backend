import { Global, Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { MinioService } from './minio.service';

@Global()
@Module({
  controllers: [FilesController],
  providers: [MinioService],
  exports: [MinioService],
})
export class FilesModule {}
