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
import {
  BlockLevelGuard,
  RequireUnblocked,
} from '../../auth/guards/block-level.guard';
import { NfseService } from './nfse.service';
import {
  EmitNfseDto,
  EmitNfseFromOrderDto,
  CancelNfseDto,
  NfseFilterDto,
} from './dtos/nfse.dto';

@ApiTags('Fiscal - NFS-e')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, BlockLevelGuard)
@Controller('fiscal/nfse')
export class NfseController {
  constructor(private readonly nfseService: NfseService) {}

  @Get()
  @ApiOperation({ summary: 'Listar NFS-e' })
  async findAll(@Req() req, @Query() filters: NfseFilterDto) {
    return this.nfseService.findAll(req.user.companyId, filters);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obter NFS-e por ID' })
  async findById(@Req() req, @Param('id') id: string) {
    return this.nfseService.findById(id, req.user.companyId);
  }

  @Post('emit')
  @RequireUnblocked()
  @ApiOperation({ summary: 'Emitir NFS-e a partir de uma ordem de serviço' })
  async emit(@Req() req, @Body() dto: EmitNfseFromOrderDto) {
    return this.nfseService.emitFromOrder(req.user.companyId, dto);
  }

  @Post('emit-full')
  @RequireUnblocked()
  @ApiOperation({ summary: 'Emitir NFS-e com todos os dados (manual)' })
  async emitFull(@Req() req, @Body() dto: EmitNfseDto) {
    return this.nfseService.emit(req.user.companyId, dto);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancelar NFS-e' })
  async cancel(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: CancelNfseDto,
  ) {
    return this.nfseService.cancel(id, req.user.companyId, dto);
  }

  @Get(':id/status')
  @ApiOperation({ summary: 'Consultar status da NFS-e' })
  async consultStatus(@Req() req, @Param('id') id: string) {
    return this.nfseService.consultStatus(id, req.user.companyId);
  }

  @Get(':id/pdf')
  @ApiOperation({ summary: 'Obter URL do PDF' })
  async getPdfUrl(@Req() req, @Param('id') id: string) {
    return this.nfseService.getPdfUrl(id, req.user.companyId);
  }

  @Get(':id/xml')
  @ApiOperation({ summary: 'Obter XML da NFS-e' })
  async getXml(@Req() req, @Param('id') id: string) {
    return this.nfseService.getXml(id, req.user.companyId);
  }
}
