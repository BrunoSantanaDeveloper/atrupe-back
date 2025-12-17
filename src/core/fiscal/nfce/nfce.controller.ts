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
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { NfceService } from './nfce.service';
import {
  EmitNfceDto,
  CancelNfceDto,
  InutilizarNfceDto,
  ContingenciaNfceDto,
  NfceFilterDto,
} from './dtos/nfce.dto';

@ApiTags('Fiscal - NFC-e')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('fiscal/nfce')
export class NfceController {
  constructor(private readonly nfceService: NfceService) {}

  @Get()
  @ApiOperation({ summary: 'Listar NFC-e' })
  async findAll(@Req() req, @Query() filters: NfceFilterDto) {
    return this.nfceService.findAll(req.user.companyId, filters);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obter NFC-e por ID' })
  async findById(@Req() req, @Param('id') id: string) {
    return this.nfceService.findById(id, req.user.companyId);
  }

  @Post('emit')
  @ApiOperation({ summary: 'Emitir NFC-e' })
  async emit(@Req() req, @Body() dto: EmitNfceDto) {
    return this.nfceService.emit(req.user.companyId, dto);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancelar NFC-e' })
  async cancel(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: CancelNfceDto,
  ) {
    return this.nfceService.cancel(id, req.user.companyId, dto);
  }

  @Post('inutilizar')
  @ApiOperation({ summary: 'Inutilizar numeração de NFC-e' })
  async inutilizar(@Req() req, @Body() dto: InutilizarNfceDto) {
    return this.nfceService.inutilizar(req.user.companyId, dto);
  }

  @Post('contingencia')
  @ApiOperation({ summary: 'Ativar/Desativar modo contingência' })
  async toggleContingencia(@Req() req, @Body() dto: ContingenciaNfceDto) {
    return this.nfceService.toggleContingencia(req.user.companyId, dto);
  }

  @Get(':id/status')
  @ApiOperation({ summary: 'Consultar status da NFC-e' })
  async consultStatus(@Req() req, @Param('id') id: string) {
    return this.nfceService.consultStatus(id, req.user.companyId);
  }

  @Get(':id/danfe')
  @ApiOperation({ summary: 'Obter URL do DANFE' })
  async getDanfeUrl(@Req() req, @Param('id') id: string) {
    return this.nfceService.getDanfeUrl(id, req.user.companyId);
  }

  @Get(':id/xml')
  @ApiOperation({ summary: 'Obter XML da NFC-e' })
  async getXml(@Req() req, @Param('id') id: string) {
    return this.nfceService.getXml(id, req.user.companyId);
  }

  @Get(':id/qrcode')
  @ApiOperation({ summary: 'Obter QR Code da NFC-e' })
  async getQrCode(@Req() req, @Param('id') id: string) {
    return this.nfceService.getQrCode(id, req.user.companyId);
  }
}
