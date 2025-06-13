import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FilesService } from './files.service';
import { FileInterceptor } from '@nestjs/platform-express';
import multerConfigS3 from './multer.config-s3';
@ApiTags('Upload de arquivo')
@Controller('file')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  // @Post('upload-file')
  // @UseInterceptors(FileInterceptor('file'))
  // public async uploadFiles(@UploadedFile() file: Express.Multer.File) {
  //   return await this.filesService.uploadFiles(file);
  // }

  @Post('upload-file')
  @UseInterceptors(FileInterceptor('file', multerConfigS3))
  public async uploadFilesS3(@UploadedFile() file: Express.MulterS3.File) {
    if (file) {
      return await this.filesService.uploadFilesS3(file);
    } else {
      throw new BadRequestException('file not found');
    }
  }
}
