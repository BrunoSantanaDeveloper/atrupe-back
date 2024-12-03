import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { MinioModule } from 'src/svc/file-upload/minio.module';

@Module({
  imports: [MinioModule],
  providers: [FilesService],
  controllers: [FilesController],
})
export class FilesModule {}
