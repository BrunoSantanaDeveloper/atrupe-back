import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import {
  BlockLevelGuard,
  RequireUnblocked,
} from '../../auth/guards/block-level.guard';
import { PermissionsGuard } from '../../auth/abac/permissions.guard';
import { HasPermission } from '../../auth/abac/has-permission.decorator';
import { NfseService } from './nfse.service';
import {
  EmitNfseDto,
  EmitNfseFromOrderDto,
  EmitNfseFromOrdersDto,
  CancelNfseDto,
  NfseFilterDto,
} from './dtos/nfse.dto';

@ApiTags('Fiscal - NFS-e')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, BlockLevelGuard)
@Controller('fiscal/nfse')
export class NfseController {
  constructor(private readonly nfseService: NfseService) {}

  @Get()
  @HasPermission('view', 'nota_fiscal:emitidas')
  @ApiOperation({ summary: 'Listar NFS-e' })
  async findAll(@Req() req, @Query() filters: NfseFilterDto) {
    return this.nfseService.findAll(req.user.companyId, filters);
  }

  @Get('prepare-standalone')
  @HasPermission('view', 'nota_fiscal:emitir')
  @ApiOperation({
    summary:
      'Preparar dados para emissão de NFS-e avulsa (sem ordem de serviço)',
  })
  async prepareStandalone(@Req() req, @Query('clientId') clientId?: string) {
    return this.nfseService.prepareStandalone(req.user.companyId, clientId);
  }

  // Precede @Get(':id') para não ser capturado como um id de NFS-e.
  @Get('conferir-emissao')
  @HasPermission('view', 'nota_fiscal:emitir')
  @ApiOperation({
    summary:
      'Conferir cadastro fiscal dos serviços e qual código a nota vai carregar',
  })
  async conferirEmissao(@Req() req, @Query('orderIds') orderIds: string) {
    const ids = (orderIds || '')
      .split(',')
      .map((i) => i.trim())
      .filter(Boolean);
    return this.nfseService.conferirEmissao(req.user.companyId, ids);
  }

  @Get(':id')
  @HasPermission('view', 'nota_fiscal:emitidas')
  @ApiOperation({ summary: 'Obter NFS-e por ID' })
  async findById(@Req() req, @Param('id') id: string) {
    return this.nfseService.findById(id, req.user.companyId);
  }

  // Previews antes das rotas ':id/...' e com os MESMOS DTOs da emissão: um
  // DTO paralelo viraria outra allowlist, e o ValidationPipe global derruba
  // campo desconhecido com 400. Fora do throttle porque não falam com o
  // provedor.
  @Post('preview')
  @SkipThrottle()
  @HasPermission('view', 'nota_fiscal:emitir')
  @ApiOperation({
    summary: 'Pré-visualizar a NFS-e de uma ordem, sem reservar RPS',
  })
  async preview(@Req() req, @Body() dto: EmitNfseFromOrderDto) {
    return this.nfseService.previewFromOrder(req.user.companyId, dto);
  }

  @Post('preview-consolidated')
  @SkipThrottle()
  @HasPermission('view', 'nota_fiscal:emitir')
  @ApiOperation({ summary: 'Pré-visualizar a NFS-e consolidada' })
  async previewConsolidated(@Req() req, @Body() dto: EmitNfseFromOrdersDto) {
    return this.nfseService.previewFromOrders(req.user.companyId, dto);
  }

  @Post('preview-full')
  @SkipThrottle()
  @HasPermission('view', 'nota_fiscal:emitir')
  @ApiOperation({ summary: 'Pré-visualizar a NFS-e avulsa' })
  async previewFull(@Req() req, @Body() dto: EmitNfseDto) {
    return this.nfseService.preview(req.user.companyId, dto);
  }

  @Post('emit')
  @HasPermission('create', 'nota_fiscal:emitir')
  @RequireUnblocked()
  @ApiOperation({ summary: 'Emitir NFS-e a partir de uma ordem de serviço' })
  async emit(@Req() req, @Body() dto: EmitNfseFromOrderDto) {
    return this.nfseService.emitFromOrder(req.user.companyId, dto);
  }

  @Post('emit-consolidated')
  @HasPermission('create', 'nota_fiscal:emitir')
  @RequireUnblocked()
  @ApiOperation({
    summary: 'Emitir NFS-e consolidada a partir de múltiplas ordens de serviço',
  })
  async emitConsolidated(@Req() req, @Body() dto: EmitNfseFromOrdersDto) {
    return this.nfseService.emitFromOrders(req.user.companyId, dto);
  }

  @Post('emit-full')
  @HasPermission('create', 'nota_fiscal:emitir')
  @RequireUnblocked()
  @ApiOperation({ summary: 'Emitir NFS-e com todos os dados (manual)' })
  async emitFull(@Req() req, @Body() dto: EmitNfseDto) {
    return this.nfseService.emit(req.user.companyId, dto);
  }

  @Post(':id/cancel')
  @HasPermission('delete', 'nota_fiscal:cancelar')
  @ApiOperation({ summary: 'Cancelar NFS-e' })
  async cancel(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: CancelNfseDto,
  ) {
    return this.nfseService.cancel(id, req.user.companyId, dto);
  }

  @Post('reconcile')
  @HasPermission('view', 'nota_fiscal:emitidas')
  @ApiOperation({
    summary:
      'Reconciliar NFS-e pendentes com o provedor (PROCESSING e rejeitadas sem número)',
  })
  async reconcilePending(@Req() req) {
    return this.nfseService.reconcilePending(req.user.companyId);
  }

  @Get(':id/status')
  @HasPermission('view', 'nota_fiscal:emitidas')
  @ApiOperation({
    summary: 'Consultar status da NFS-e no provedor e reconciliar o registro',
  })
  async consultStatus(@Req() req, @Param('id') id: string) {
    return this.nfseService.consultStatus(id, req.user.companyId);
  }

  @Get(':id/pdf')
  @HasPermission('view', 'nota_fiscal:emitidas')
  @ApiOperation({ summary: 'Obter URL do PDF' })
  async getPdfUrl(@Req() req, @Param('id') id: string) {
    return this.nfseService.getPdfUrl(id, req.user.companyId);
  }

  @Get(':id/xml')
  @HasPermission('view', 'nota_fiscal:emitidas')
  @ApiOperation({ summary: 'Obter XML da NFS-e' })
  async getXml(@Req() req, @Param('id') id: string) {
    return this.nfseService.getXml(id, req.user.companyId);
  }

  @Post(':id/send-email')
  @HasPermission('view', 'nota_fiscal:emitidas')
  @ApiOperation({ summary: 'Enviar PDF/XML da NFS-e por e-mail ao tomador' })
  async sendEmail(@Req() req, @Param('id') id: string) {
    return this.nfseService.sendAuthorizedEmail(id, req.user.companyId);
  }
}
