import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import {
  BlockLevelGuard,
  RequireUnblocked,
} from '../../auth/guards/block-level.guard';
import { PermissionsGuard } from '../../auth/abac/permissions.guard';
import { HasPermission } from '../../auth/abac/has-permission.decorator';
import { NfeService } from './nfe.service';
import {
  EmitNfeDto,
  EmitNfeFromOrderDto,
  CreateConsolidatedNfeDraftDto,
  CancelNfeDto,
  CorrectionLetterDto,
  InutilizarNfeDto,
  NfeFilterDto,
  UpdateNfeDraftDto,
} from './dtos/nfe.dto';

@ApiTags('Fiscal - NF-e')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, BlockLevelGuard)
@Controller('fiscal/nfe')
export class NfeController {
  constructor(private readonly nfeService: NfeService) {}

  @Get()
  @HasPermission('view', 'nota_fiscal:emitidas')
  @ApiOperation({ summary: 'Listar NF-e' })
  async findAll(@Req() req, @Query() filters: NfeFilterDto) {
    return this.nfeService.findAll(req.user.companyId, filters);
  }

  @Get('prepare-standalone')
  @HasPermission('view', 'nota_fiscal:emitir')
  @ApiOperation({
    summary:
      'Preparar dados para emissão de NF-e avulsa (sem ordem de serviço)',
  })
  async prepareStandalone(@Req() req, @Query('clientId') clientId?: string) {
    return this.nfeService.prepareStandalone(req.user.companyId, clientId);
  }

  @Get('prepare/:orderId')
  @HasPermission('view', 'nota_fiscal:emitir')
  @ApiOperation({
    summary: 'Preparar dados para emissão de NF-e a partir de uma ordem',
  })
  async prepareFromOrder(@Req() req, @Param('orderId') orderId: string) {
    return this.nfeService.prepareFromOrder(req.user.companyId, orderId);
  }

  // ==================== Draft Endpoints ====================

  @Post('draft/consolidated')
  @HasPermission('create', 'nota_fiscal:emitir')
  @ApiOperation({
    summary: 'Criar ou obter rascunho consolidado de NF-e para varias ordens',
  })
  async createOrGetConsolidatedDraft(
    @Req() req,
    @Body() dto: CreateConsolidatedNfeDraftDto,
  ) {
    return this.nfeService.createOrGetConsolidatedDraft(
      req.user.companyId,
      dto.orderIds,
    );
  }

  @Post('draft/:orderId')
  @HasPermission('create', 'nota_fiscal:emitir')
  @ApiOperation({
    summary: 'Criar ou obter rascunho de NF-e para uma ordem',
  })
  async createOrGetDraft(@Req() req, @Param('orderId') orderId: string) {
    return this.nfeService.createOrGetDraft(req.user.companyId, orderId);
  }

  @Patch('draft/:id')
  @HasPermission('edit', 'nota_fiscal:emitir')
  @ApiOperation({ summary: 'Atualizar rascunho de NF-e' })
  async updateDraft(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: UpdateNfeDraftDto,
  ) {
    return this.nfeService.updateDraft(req.user.companyId, id, dto);
  }

  @Delete('draft/:id')
  @HasPermission('delete', 'nota_fiscal:emitir')
  @ApiOperation({ summary: 'Deletar rascunho de NF-e (cancelar digitação)' })
  async deleteDraft(@Req() req, @Param('id') id: string) {
    return this.nfeService.deleteDraft(req.user.companyId, id);
  }

  @Post('inutilizar')
  @HasPermission('create', 'nota_fiscal:emitir')
  @RequireUnblocked()
  @ApiOperation({ summary: 'Inutilizar faixa de numeração de NF-e' })
  async inutilizar(@Req() req, @Body() dto: InutilizarNfeDto) {
    return this.nfeService.inutilizar(req.user.companyId, dto);
  }

  // ==================== NF-e Endpoints ====================

  @Get(':id')
  @HasPermission('view', 'nota_fiscal:emitidas')
  @ApiOperation({ summary: 'Obter NF-e por ID' })
  async findById(@Req() req, @Param('id') id: string) {
    return this.nfeService.findById(id, req.user.companyId);
  }

  @Post('emit')
  @HasPermission('create', 'nota_fiscal:emitir')
  @RequireUnblocked()
  @ApiOperation({ summary: 'Emitir NF-e a partir de uma ordem de serviço' })
  async emit(@Req() req, @Body() dto: EmitNfeFromOrderDto) {
    return this.nfeService.emitFromOrder(req.user.companyId, dto);
  }

  @Post('emit-full')
  @HasPermission('create', 'nota_fiscal:emitir')
  @RequireUnblocked()
  @ApiOperation({ summary: 'Emitir NF-e com todos os dados (manual)' })
  async emitFull(@Req() req, @Body() dto: EmitNfeDto) {
    return this.nfeService.emit(req.user.companyId, dto);
  }

  @Post('emit-consolidated')
  @HasPermission('create', 'nota_fiscal:emitir')
  @RequireUnblocked()
  @ApiOperation({ summary: 'Emitir NF-e consolidada para varias ordens' })
  async emitConsolidated(@Req() req, @Body() dto: EmitNfeDto) {
    return this.nfeService.emitConsolidated(req.user.companyId, dto);
  }

  @Post(':id/cancel')
  @HasPermission('delete', 'nota_fiscal:cancelar')
  @ApiOperation({ summary: 'Cancelar NF-e' })
  async cancel(@Req() req, @Param('id') id: string, @Body() dto: CancelNfeDto) {
    return this.nfeService.cancel(id, req.user.companyId, dto);
  }

  @Post(':id/correction-letter')
  @HasPermission('edit', 'nota_fiscal:emitir')
  @ApiOperation({ summary: 'Enviar carta de correção' })
  async sendCorrectionLetter(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: CorrectionLetterDto,
  ) {
    return this.nfeService.sendCorrectionLetter(id, req.user.companyId, dto);
  }

  @Get(':id/corrections')
  @HasPermission('view', 'nota_fiscal:emitidas')
  @ApiOperation({ summary: 'Listar histórico de cartas de correção' })
  async listCorrections(@Req() req, @Param('id') id: string) {
    return this.nfeService.listCorrectionEvents(id, req.user.companyId);
  }

  @Get(':id/status')
  @HasPermission('view', 'nota_fiscal:emitidas')
  @ApiOperation({ summary: 'Consultar status da NF-e' })
  async consultStatus(@Req() req, @Param('id') id: string) {
    return this.nfeService.consultStatus(id, req.user.companyId);
  }

  @Get(':id/danfe')
  @HasPermission('view', 'nota_fiscal:emitidas')
  @ApiOperation({ summary: 'Obter URL do DANFE' })
  async getDanfeUrl(@Req() req, @Param('id') id: string) {
    return this.nfeService.getDanfeUrl(id, req.user.companyId);
  }

  @Get(':id/xml')
  @HasPermission('view', 'nota_fiscal:emitidas')
  @ApiOperation({ summary: 'Obter XML da NF-e' })
  async getXml(@Req() req, @Param('id') id: string) {
    return this.nfeService.getXml(id, req.user.companyId);
  }
}
