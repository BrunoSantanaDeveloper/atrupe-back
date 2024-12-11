import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { FilesService } from './files.service';

@ApiTags('Upload de arquivo')
@Controller('file')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload-image')
  @UseInterceptors(FileInterceptor('image'))
  public async uploadFiles(@UploadedFile() image: Express.Multer.File) {
    console.log('imagem', image);
    return await this.filesService.uploadFiles(image);
  }
}
