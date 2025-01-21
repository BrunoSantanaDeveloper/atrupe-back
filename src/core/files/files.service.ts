import { Injectable } from '@nestjs/common';
import { MinioService } from 'src/svc/file-upload/minio.service';

@Injectable()
export class FilesService {
  constructor(private readonly minioService: MinioService) {}
  async uploadFiles(image: Express.Multer.File) {
    try {
      const fileUrl = await this.minioService.uploadFile(image);
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

  async uploadFilesS3(image: Express.MulterS3.File) {
    try {
      return image.location;
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
