import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { PermissionsGuard } from '../../auth/abac/permissions.guard';
import { BlockLevelGuard } from '../../auth/guards/block-level.guard';
import { HasPermission } from '../../auth/abac/has-permission.decorator';
import { FiscalStandaloneDraftService } from './fiscal-standalone-draft.service';
import {
  DocTypeRascunho,
  SaveStandaloneDraftDto,
} from './dtos/standalone-draft.dto';

@ApiTags('Fiscal - Rascunhos de nota avulsa')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, BlockLevelGuard)
@Controller('fiscal/drafts')
export class FiscalStandaloneDraftController {
  constructor(private readonly draftService: FiscalStandaloneDraftService) {}

  @Get()
  @HasPermission('create', 'nota_fiscal:emitir')
  @ApiOperation({ summary: 'Listar rascunhos de nota avulsa' })
  async list(@Req() req, @Query('docType') docType?: DocTypeRascunho) {
    return this.draftService.list(req.user.companyId, docType);
  }

  @Get(':id')
  @HasPermission('create', 'nota_fiscal:emitir')
  @ApiOperation({ summary: 'Abrir um rascunho para continuar a digitação' })
  async findOne(@Req() req, @Param('id') id: string) {
    return this.draftService.findOne(req.user.companyId, id);
  }

  @Post()
  @HasPermission('create', 'nota_fiscal:emitir')
  @ApiOperation({ summary: 'Salvar rascunho (cria ou atualiza pelo id)' })
  async save(@Req() req, @Body() dto: SaveStandaloneDraftDto) {
    return this.draftService.save(req.user.companyId, dto, {
      id: req.user.id,
      name: req.user.name,
    });
  }

  @Delete(':id')
  @HasPermission('create', 'nota_fiscal:emitir')
  @ApiOperation({ summary: 'Descartar rascunho' })
  async remove(@Req() req, @Param('id') id: string) {
    return this.draftService.remove(req.user.companyId, id);
  }
}
