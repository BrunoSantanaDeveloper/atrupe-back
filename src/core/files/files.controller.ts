import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FilesService } from './files.service';
import { FileInterceptor } from '@nestjs/platform-express';
import multerConfigS3 from './multer.config-s3';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';

// Sem login, qualquer um na internet gravava arquivo no bucket. O front só
// envia arquivo de dentro da área logada, com o token. O guard roda antes
// do interceptor, então o arquivo de quem não está logado nem sobe.
@ApiTags('Upload de arquivo')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
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
