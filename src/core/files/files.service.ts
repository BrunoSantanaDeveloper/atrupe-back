import { Injectable } from '@nestjs/common';
import { MinioService } from 'src/svc/file-upload/minio.service';

@Injectable()
export class FilesService {
  constructor(private readonly minioService: MinioService) {}
  async uploadFiles(file: Express.Multer.File) {
    try {
      const fileUrl = await this.minioService.uploadFile(file);
      return fileUrl;
    } catch (error) {
      return {
        success: false,
        data: {
          code: 403,
          msg: error.message,
        },
      };
    }
  }

  async uploadFilesS3(file: Express.MulterS3.File) {
    try {
      return file.location;
    } catch (error) {
      console.error(error);
      return {
        success: false,
        data: {
          where: 'files',
          code: 403,
          msg: error,
        },
      };
    }
  }
}
