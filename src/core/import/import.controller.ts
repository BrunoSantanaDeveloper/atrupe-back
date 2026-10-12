import { PermissionsGuard } from 'src/core/auth/abac/permissions.guard';
import { HasAnyPermission } from 'src/core/auth/abac/has-any-permission.decorator';
import { ObservePermissions } from 'src/core/auth/abac/observe-permissions.decorator';
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
import { TenantGuard } from 'src/core/auth/guards/tenant.guard';
import { TenantResource } from 'src/core/auth/guards/tenant-resource.decorator';

@ApiTags('Import')
// Permissão no endpoint em modo observar (Fase 2): a recusa vai para o log
// sem recusar, até a semana de log limpo; handler com
// @ObservePermissions(false) já recusa.
@ObservePermissions()
@Controller('import')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class ImportController {
  constructor(private importService: ImportService) {}

  @Post('upload')
  @HasAnyPermission(
    { action: 'create', resource: 'register:client' },
    { action: 'create', resource: 'register:supplier' },
    { action: 'create', resource: 'product_settings:products' },
    { action: 'create', resource: 'sale:quotation' },
    { action: 'create', resource: 'sale:order' },
    { action: 'create', resource: 'financial:flow' },
  )
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
  @HasAnyPermission(
    { action: 'create', resource: 'register:client' },
    { action: 'create', resource: 'register:supplier' },
    { action: 'create', resource: 'product_settings:products' },
    { action: 'create', resource: 'sale:quotation' },
    { action: 'create', resource: 'sale:order' },
    { action: 'create', resource: 'financial:flow' },
  )
  @TenantResource('importLog')
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
  @HasAnyPermission(
    { action: 'create', resource: 'register:client' },
    { action: 'create', resource: 'register:supplier' },
    { action: 'create', resource: 'product_settings:products' },
    { action: 'create', resource: 'sale:quotation' },
    { action: 'create', resource: 'sale:order' },
    { action: 'create', resource: 'financial:flow' },
  )
  @TenantResource('importLog')
  @ApiOperation({
    summary:
      'Cria os cadastros citados no CSV (natureza, subcategoria, conta bancária) que a empresa ainda não tem',
  })
  async createReferences(@Param('id') importId: string) {
    return this.importService.createMissingReferences(importId);
  }

  @Post(':id/process')
  @HasAnyPermission(
    { action: 'create', resource: 'register:client' },
    { action: 'create', resource: 'register:supplier' },
    { action: 'create', resource: 'product_settings:products' },
    { action: 'create', resource: 'sale:quotation' },
    { action: 'create', resource: 'sale:order' },
    { action: 'create', resource: 'financial:flow' },
  )
  @TenantResource('importLog')
  @ApiOperation({ summary: 'Process import after validation' })
  async processImport(@Param('id') importId: string) {
    const result = await this.importService.processImport(importId);
    return result;
  }

  @Get(':id/status')
  @HasAnyPermission(
    { action: 'create', resource: 'register:client' },
    { action: 'create', resource: 'register:supplier' },
    { action: 'create', resource: 'product_settings:products' },
    { action: 'create', resource: 'sale:quotation' },
    { action: 'create', resource: 'sale:order' },
    { action: 'create', resource: 'financial:flow' },
  )
  @TenantResource('importLog')
  @ApiOperation({ summary: 'Get import status' })
  async getStatus(@Param('id') importId: string) {
    return this.importService.getImportStatus(importId);
  }

  @Get('list')
  @HasAnyPermission(
    { action: 'create', resource: 'register:client' },
    { action: 'create', resource: 'register:supplier' },
    { action: 'create', resource: 'product_settings:products' },
    { action: 'create', resource: 'sale:quotation' },
    { action: 'create', resource: 'sale:order' },
    { action: 'create', resource: 'financial:flow' },
  )
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
