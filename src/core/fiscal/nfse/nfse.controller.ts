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
import { PermissionsGuard } from '../../auth/abac/permissions.guard';
import { HasPermission } from '../../auth/abac/has-permission.decorator';
import { NfseService } from './nfse.service';
import {
  EmitNfseDto,
  EmitNfseFromOrderDto,
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

  @Get(':id')
  @HasPermission('view', 'nota_fiscal:emitidas')
  @ApiOperation({ summary: 'Obter NFS-e por ID' })
  async findById(@Req() req, @Param('id') id: string) {
    return this.nfseService.findById(id, req.user.companyId);
  }

  @Post('emit')
  @HasPermission('create', 'nota_fiscal:emitir')
  @RequireUnblocked()
  @ApiOperation({ summary: 'Emitir NFS-e a partir de uma ordem de serviço' })
  async emit(@Req() req, @Body() dto: EmitNfseFromOrderDto) {
    return this.nfseService.emitFromOrder(req.user.companyId, dto);
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

  @Get(':id/status')
  @HasPermission('view', 'nota_fiscal:emitidas')
  @ApiOperation({ summary: 'Consultar status da NFS-e' })
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
}
