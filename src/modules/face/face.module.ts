import { Global, Module } from '@nestjs/common';
import { FaceService } from './face.service';

@Global()
@Module({
  providers: [FaceService],
  exports: [FaceService],
})
export class FaceModule {}
