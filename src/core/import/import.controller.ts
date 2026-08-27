import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Req,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { ImportService } from './import.service';
import { UploadImportDto } from './dto';

@ApiTags('Import')
@Controller('import')
@UseGuards(JwtAuthGuard)
export class ImportController {
  constructor(private importService: ImportService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload CSV file for import' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
        entity: {
          type: 'string',
          enum: [
            'client',
            'product',
            'quotation',
            'supplier',
            'financial',
            'order',
            'employee',
          ],
        },
      },
    },
  })
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadImportDto,
    @Req() req,
  ) {
    // Obter userId e companyId do token JWT
    const userId = req.user?.userId;
    const companyId = req.user?.companyId;

    if (!userId) {
      throw new Error('User ID not found in JWT token');
    }

    if (!companyId) {
      throw new Error('Company ID not found in JWT token');
    }

    const importLog = await this.importService.createImport(
      file,
      dto.entity,
      userId,
      companyId,
    );

    return {
      importId: importLog.id,
      status: importLog.status,
      message:
        'File uploaded successfully. Use /import/:id/validate to validate before importing.',
    };
  }

  @Post(':id/validate')
  @ApiOperation({ summary: 'Validate CSV data before importing' })
  async validateImport(
    @Param('id') importId: string,
    @Query('allowOverride') allowOverride?: string,
  ) {
    const override = allowOverride === 'true';
    const result = await this.importService.validateCsv(importId, override);
    return result;
  }

  @Post(':id/references')
  @ApiOperation({
    summary:
      'Cria os cadastros citados no CSV (natureza, subcategoria, conta bancária) que a empresa ainda não tem',
  })
  async createReferences(@Param('id') importId: string) {
    return this.importService.createMissingReferences(importId);
  }

  @Post(':id/process')
  @ApiOperation({ summary: 'Process import after validation' })
  async processImport(@Param('id') importId: string) {
    const result = await this.importService.processImport(importId);
    return result;
  }

  @Get(':id/status')
  @ApiOperation({ summary: 'Get import status' })
  async getStatus(@Param('id') importId: string) {
    return this.importService.getImportStatus(importId);
  }

  @Get('list')
  @ApiOperation({ summary: 'List all imports for company' })
  async listImports(
    @Req() req,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    const companyId = req.user?.companyId;
    return this.importService.listImports(companyId, +page, +limit);
  }
}
