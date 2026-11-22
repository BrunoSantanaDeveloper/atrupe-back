import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { HasPermission } from '../auth/abac/has-permission.decorator';
import { PermissionsGuard } from '../auth/abac/permissions.guard';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { DirectFileDto, UploadLinkDto } from './dto/production-task.dto';
import { ATTACHMENT_MAX_BYTES } from './production-task.service';
import { OrderFilesService } from './storage/order-files.service';

const fileUpload = FileInterceptor('file', {
  storage: memoryStorage(),
  limits: { fileSize: ATTACHMENT_MAX_BYTES + 5 * 1024 * 1024, files: 1 },
});

const ORDER = 'sale:order';

/**
 * Os arquivos da O.S. geral (GP-49): vê quem vê a O.S.; acrescenta e apaga
 * quem edita. Em todos os planos, dentro do espaço dos arquivos.
 */
@ApiTags('Ordem de serviço › arquivos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('sale/order-file')
export class OrderFilesController {
  constructor(private readonly files: OrderFilesService) {}

  @Get(':orderId')
  @HasPermission('view', ORDER)
  @ApiOperation({ summary: 'Os arquivos da O.S., com o espaço usado' })
  list(@Req() req, @Param('orderId') orderId: string) {
    return this.files.list(req.user, orderId);
  }

  @Post(':orderId')
  @HasPermission('edit', ORDER)
  @UseInterceptors(fileUpload)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Acrescenta um arquivo pelo servidor (até 20 MB)' })
  add(
    @Req() req,
    @Param('orderId') orderId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.files.add(req.user, orderId, file);
  }

  @Post(':orderId/upload-link')
  @HasPermission('edit', ORDER)
  @ApiOperation({ summary: 'O link para enviar direto ao armazenamento' })
  uploadLink(
    @Req() req,
    @Param('orderId') orderId: string,
    @Body() dto: UploadLinkDto,
  ) {
    return this.files.uploadLink(req.user, orderId, dto);
  }

  @Post(':orderId/direct')
  @HasPermission('edit', ORDER)
  @ApiOperation({ summary: 'Registra o arquivo enviado direto' })
  addDirect(
    @Req() req,
    @Param('orderId') orderId: string,
    @Body() dto: DirectFileDto,
  ) {
    return this.files.addDirect(req.user, orderId, dto);
  }

  @Delete(':orderId/:fileId')
  @HasPermission('edit', ORDER)
  @ApiOperation({ summary: 'Apaga um arquivo da O.S.' })
  remove(
    @Req() req,
    @Param('orderId') orderId: string,
    @Param('fileId') fileId: string,
  ) {
    return this.files.remove(req.user, orderId, fileId);
  }
}
