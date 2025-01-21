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

  // @Post('upload-image')
  // @UseInterceptors(FileInterceptor('image'))
  // public async uploadFiles(@UploadedFile() image: Express.Multer.File) {
  //   return await this.filesService.uploadFiles(image);
  // }

  @Post('upload-image')
  @UseInterceptors(FileInterceptor('image', multerConfigS3))
  public async uploadFilesS3(@UploadedFile() image: Express.MulterS3.File) {
    if (image) {
      return await this.filesService.uploadFilesS3(image);
    } else {
      throw new BadRequestException('Image not found');
    }
  }
}
