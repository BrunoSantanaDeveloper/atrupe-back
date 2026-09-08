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
  Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { FiscalThrottlerGuard } from './guards/fiscal-throttler.guard';
import { Response } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import {
  BlockLevelGuard,
  RequireUnblocked,
} from '../../auth/guards/block-level.guard';
import { PermissionsGuard } from '../../auth/abac/permissions.guard';
import { HasPermission } from '../../auth/abac/has-permission.decorator';
import { HasAnyPermission } from '../../auth/abac/has-any-permission.decorator';
import { NfeService } from './nfe.service';
import { NfeEventsService } from './nfe-events.service';
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
@UseGuards(
  JwtAuthGuard,
  PermissionsGuard,
  BlockLevelGuard,
  FiscalThrottlerGuard,
)
@Controller('fiscal/nfe')
export class NfeController {
  constructor(
    private readonly nfeService: NfeService,
    private readonly nfeEventsService: NfeEventsService,
  ) {}

  // Leituras que so tocam o banco ficam fora do teto de 10/min do modulo: a
  // tela de emissao refaz a consulta a cada troca de aba/filtro e o throttler,
  // chaveado por IP, zerava a listagem inteira com 429 apos poucos cliques.
  @Get()
  @SkipThrottle()
  @HasPermission('view', 'nota_fiscal:emitidas')
  @ApiOperation({ summary: 'Listar NF-e' })
  async findAll(@Req() req, @Query() filters: NfeFilterDto) {
    return this.nfeService.findAll(req.user.companyId, filters);
  }

  @Get('unified')
  @SkipThrottle()
  @HasPermission('view', 'nota_fiscal:emitidas')
  @ApiOperation({ summary: 'Listagem unificada de Notas Fiscais e Pedidos' })
  async findUnified(@Req() req, @Query() filters: any) {
    return this.nfeService.findUnified(req.user.companyId, filters);
  }

  @Get('prepare-standalone')
  @SkipThrottle()
  @HasPermission('view', 'nota_fiscal:emitir')
  @ApiOperation({
    summary:
      'Preparar dados para emissão de NF-e avulsa (sem ordem de serviço)',
  })
  async prepareStandalone(@Req() req, @Query('clientId') clientId?: string) {
    return this.nfeService.prepareStandalone(req.user.companyId, clientId);
  }

  @Get('prepare/:orderId')
  @SkipThrottle()
  @HasPermission('view', 'nota_fiscal:emitir')
  @ApiOperation({
    summary: 'Preparar dados para emissão de NF-e a partir de uma ordem',
  })
  async prepareFromOrder(@Req() req, @Param('orderId') orderId: string) {
    return this.nfeService.prepareFromOrder(req.user.companyId, orderId);
  }

  @Get(':id/prepare-devolution')
  @SkipThrottle()
  @HasPermission('create', 'nota_fiscal:emitir')
  @ApiOperation({ summary: 'Preparar dados para emissão de NF-e de devolução' })
  async prepareDevolution(@Req() req, @Param('id') id: string) {
    return this.nfeService.prepareDevolution(req.user.companyId, id);
  }

  @Get(':id/prepare-complementary')
  @SkipThrottle()
  @HasPermission('create', 'nota_fiscal:emitir')
  @ApiOperation({ summary: 'Preparar dados para emissão de NF-e complementar' })
  async prepareComplementary(@Req() req, @Param('id') id: string) {
    return this.nfeService.prepareComplementary(req.user.companyId, id);
  }

  @Get(':id/prepare-reissue')
  @SkipThrottle()
  @HasPermission('create', 'nota_fiscal:emitir')
  @ApiOperation({ summary: 'Preparar dados para reemissão de NF-e rejeitada' })
  async prepareReissue(@Req() req, @Param('id') id: string) {
    return this.nfeService.prepareReissue(req.user.companyId, id);
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
  @SkipThrottle()
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

  // Antes das rotas ':id/...' e com o MESMO DTO da emissão: um DTO paralelo
  // viraria mais uma allowlist, e o ValidationPipe global derruba campo
  // desconhecido com 400. Fora do throttle porque não fala com o provedor —
  // duas prévias não podem consumir a cota da emissão seguinte.
  @Post('preview')
  @SkipThrottle()
  @HasPermission('view', 'nota_fiscal:emitir')
  @ApiOperation({
    summary: 'Pré-visualizar a NF-e sem reservar número nem transmitir',
  })
  async preview(@Req() req, @Body() dto: EmitNfeDto) {
    return this.nfeService.preview(req.user.companyId, dto);
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
    const nfe = await this.nfeService.findById(id, req.user.companyId);
    return this.nfeEventsService.cancel(nfe, req.user.companyId, dto);
  }

  @Post(':id/correction-letter')
  @HasPermission('edit', 'nota_fiscal:carta_correcao')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Enviar carta de correção' })
  async sendCorrectionLetter(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: CorrectionLetterDto,
  ) {
    const nfe = await this.nfeService.findById(id, req.user.companyId);
    return this.nfeEventsService.sendCorrectionLetter(
      nfe,
      req.user.companyId,
      dto,
      { userId: req.user.userId, name: req.user.username },
    );
  }

  @Get(':id/corrections')
  @SkipThrottle()
  @HasAnyPermission(
    { action: 'view', resource: 'nota_fiscal:carta_correcao' },
    { action: 'view', resource: 'nota_fiscal:emitidas' },
  )
  @ApiOperation({ summary: 'Listar histórico de cartas de correção' })
  async listCorrections(@Req() req, @Param('id') id: string) {
    return this.nfeService.listCorrectionEvents(id, req.user.companyId);
  }

  @Get(':id/corrections/:eventId/xml')
  @SkipThrottle()
  @HasAnyPermission(
    { action: 'view', resource: 'nota_fiscal:carta_correcao' },
    { action: 'view', resource: 'nota_fiscal:emitidas' },
  )
  @ApiOperation({ summary: 'Download do XML de uma carta de correção (CC-e)' })
  async getCorrectionEventXml(
    @Req() req,
    @Param('id') id: string,
    @Param('eventId') eventId: string,
  ) {
    return this.nfeService.getCorrectionEventXml(
      id,
      eventId,
      req.user.companyId,
    );
  }

  // Sem SkipThrottle: na primeira vez isso vai ao provedor buscar a DACCE, ao
  // contrario do XML que sai direto do banco.
  @Get(':id/corrections/:eventId/pdf')
  @HasAnyPermission(
    { action: 'view', resource: 'nota_fiscal:carta_correcao' },
    { action: 'view', resource: 'nota_fiscal:emitidas' },
  )
  @ApiOperation({ summary: 'Download da DACCE (PDF) de uma carta de correção' })
  async getCorrectionEventPdf(
    @Req() req,
    @Param('id') id: string,
    @Param('eventId') eventId: string,
  ) {
    return this.nfeService.getCorrectionEventPdf(
      id,
      eventId,
      req.user.companyId,
    );
  }

  @Get(':id/status')
  @HasPermission('view', 'nota_fiscal:emitidas')
  @ApiOperation({ summary: 'Consultar status da NF-e' })
  async consultStatus(@Req() req, @Param('id') id: string) {
    return this.nfeService.consultStatus(id, req.user.companyId);
  }

  @Get(':id/danfe')
  @SkipThrottle()
  @HasPermission('view', 'nota_fiscal:emitidas')
  @ApiOperation({ summary: 'Obter URL do DANFE' })
  async getDanfeUrl(@Req() req, @Param('id') id: string) {
    return this.nfeService.getDanfeUrl(id, req.user.companyId);
  }

  @Get(':id/xml')
  @SkipThrottle()
  @HasPermission('view', 'nota_fiscal:emitidas')
  @ApiOperation({ summary: 'Obter XML da NF-e' })
  async getXml(@Req() req, @Param('id') id: string) {
    return this.nfeService.getXml(id, req.user.companyId);
  }

  @Post(':id/send-email')
  @HasPermission('view', 'nota_fiscal:emitidas')
  @ApiOperation({ summary: 'Enviar DANFE/XML da NF-e por e-mail' })
  async sendEmail(@Req() req, @Param('id') id: string) {
    return this.nfeService.sendAuthorizedEmail(id, req.user.companyId);
  }

  @Get('export-xml/zip')
  @HasPermission('view', 'nota_fiscal:emitidas')
  @ApiOperation({ summary: 'Exportar XMLs de NF-e em ZIP por período' })
  async exportXml(
    @Req() req,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Res() res: Response,
  ) {
    const { zip, total, faltantes } = await this.nfeService.exportXml(
      req.user.companyId,
      startDate,
      endDate,
    );

    const filename = `NFe_XMLs_${startDate}_${endDate}.zip`;
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': zip.length.toString(),
      // Lidos pelo front para avisar quando o ZIP saiu parcial (ver
      // exposedHeaders no CORS).
      'X-Nfe-Total': String(total),
      'X-Nfe-Missing-Xml': String(faltantes.length),
    });
    res.end(zip);
  }
}
