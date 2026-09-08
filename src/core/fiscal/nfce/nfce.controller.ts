import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Response } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import {
  BlockLevelGuard,
  RequireUnblocked,
} from '../../auth/guards/block-level.guard';
import { PermissionsGuard } from '../../auth/abac/permissions.guard';
import { HasPermission } from '../../auth/abac/has-permission.decorator';
import { NfceService } from './nfce.service';
import { NfceThermalService } from './nfce-thermal.service';
import {
  EmitNfceDto,
  CancelNfceDto,
  InutilizarNfceDto,
  ContingenciaNfceDto,
  NfceFilterDto,
} from './dtos/nfce.dto';

@ApiTags('Fiscal - NFC-e')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, BlockLevelGuard)
@Controller('fiscal/nfce')
export class NfceController {
  constructor(
    private readonly nfceService: NfceService,
    private readonly nfceThermalService: NfceThermalService,
  ) {}

  @Get()
  @HasPermission('view', 'nota_fiscal:emitidas')
  @ApiOperation({ summary: 'Listar NFC-e' })
  async findAll(@Req() req, @Query() filters: NfceFilterDto) {
    return this.nfceService.findAll(req.user.companyId, filters);
  }

  @Get('prepare-standalone')
  @HasPermission('create', 'nota_fiscal:emitir')
  @ApiOperation({ summary: 'Preparar dados para NFC-e avulsa' })
  async prepareStandalone(@Req() req) {
    return this.nfceService.prepareStandalone(req.user.companyId);
  }

  @Get(':id')
  @HasPermission('view', 'nota_fiscal:emitidas')
  @ApiOperation({ summary: 'Obter NFC-e por ID' })
  async findById(@Req() req, @Param('id') id: string) {
    return this.nfceService.findById(id, req.user.companyId);
  }

  // Antes das rotas ':id/...' e com o MESMO DTO da emissão: um DTO paralelo
  // viraria outra allowlist, e o ValidationPipe global derruba campo
  // desconhecido com 400. Fora do throttle porque não fala com o provedor.
  @Post('preview')
  @SkipThrottle()
  @HasPermission('view', 'nota_fiscal:emitir')
  @ApiOperation({
    summary: 'Pré-visualizar a NFC-e sem reservar número nem transmitir',
  })
  async preview(@Req() req, @Body() dto: EmitNfceDto) {
    return this.nfceService.preview(req.user.companyId, dto);
  }

  @Post('emit')
  @HasPermission('create', 'nota_fiscal:emitir')
  @RequireUnblocked()
  @ApiOperation({ summary: 'Emitir NFC-e' })
  async emit(@Req() req, @Body() dto: EmitNfceDto) {
    return this.nfceService.emit(req.user.companyId, dto);
  }

  @Post(':id/cancel')
  @HasPermission('delete', 'nota_fiscal:cancelar')
  @ApiOperation({ summary: 'Cancelar NFC-e' })
  async cancel(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: CancelNfceDto,
  ) {
    return this.nfceService.cancel(id, req.user.companyId, dto);
  }

  @Post(':id/reprocess')
  @HasPermission('create', 'nota_fiscal:emitir')
  @RequireUnblocked()
  @ApiOperation({ summary: 'Reprocessar NFC-e (status UNKNOWN ou PROCESSING)' })
  async reprocess(@Req() req, @Param('id') id: string) {
    return this.nfceService.reprocess(id, req.user.companyId);
  }

  @Post('inutilizar')
  @HasPermission('delete', 'nota_fiscal:cancelar')
  @RequireUnblocked()
  @ApiOperation({ summary: 'Inutilizar numeração de NFC-e' })
  async inutilizar(@Req() req, @Body() dto: InutilizarNfceDto) {
    return this.nfceService.inutilizar(req.user.companyId, dto);
  }

  @Post('contingencia')
  @HasPermission('edit', 'nota_fiscal:config')
  @RequireUnblocked()
  @ApiOperation({ summary: 'Ativar/Desativar modo contingência' })
  async toggleContingencia(@Req() req, @Body() dto: ContingenciaNfceDto) {
    return this.nfceService.toggleContingencia(req.user.companyId, dto);
  }

  @Get(':id/status')
  @HasPermission('view', 'nota_fiscal:emitidas')
  @ApiOperation({ summary: 'Consultar status da NFC-e' })
  async consultStatus(@Req() req, @Param('id') id: string) {
    return this.nfceService.consultStatus(id, req.user.companyId);
  }

  @Get(':id/danfe')
  @HasPermission('view', 'nota_fiscal:emitidas')
  @ApiOperation({ summary: 'Obter URL do DANFE' })
  async getDanfeUrl(@Req() req, @Param('id') id: string) {
    return this.nfceService.getDanfeUrl(id, req.user.companyId);
  }

  @Get(':id/thermal')
  @HasPermission('view', 'nota_fiscal:emitidas')
  @ApiOperation({ summary: 'Obter DANFE NFC-e termico em HTML 80mm' })
  async getThermalDanfe(
    @Req() req,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const html = await this.nfceThermalService.generateHtml(
      id,
      req.user.companyId,
    );

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }

  @Get(':id/xml')
  @HasPermission('view', 'nota_fiscal:emitidas')
  @ApiOperation({ summary: 'Obter XML da NFC-e' })
  async getXml(@Req() req, @Param('id') id: string) {
    return this.nfceService.getXml(id, req.user.companyId);
  }

  @Get(':id/qrcode')
  @HasPermission('view', 'nota_fiscal:emitidas')
  @ApiOperation({ summary: 'Obter QR Code da NFC-e' })
  async getQrCode(@Req() req, @Param('id') id: string) {
    return this.nfceService.getQrCode(id, req.user.companyId);
  }
}
