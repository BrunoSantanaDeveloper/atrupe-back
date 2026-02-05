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
import { NfeService } from './nfe.service';
import {
  EmitNfeDto,
  EmitNfeFromOrderDto,
  CancelNfeDto,
  CorrectionLetterDto,
  NfeFilterDto,
  UpdateNfeDraftDto,
} from './dtos/nfe.dto';

@ApiTags('Fiscal - NF-e')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, BlockLevelGuard)
@Controller('fiscal/nfe')
export class NfeController {
  constructor(private readonly nfeService: NfeService) {}

  @Get()
  @ApiOperation({ summary: 'Listar NF-e' })
  async findAll(@Req() req, @Query() filters: NfeFilterDto) {
    return this.nfeService.findAll(req.user.companyId, filters);
  }

  @Get('prepare/:orderId')
  @ApiOperation({
    summary: 'Preparar dados para emissão de NF-e a partir de uma ordem',
  })
  async prepareFromOrder(@Req() req, @Param('orderId') orderId: string) {
    return this.nfeService.prepareFromOrder(req.user.companyId, orderId);
  }

  // ==================== Draft Endpoints ====================

  @Post('draft/:orderId')
  @ApiOperation({
    summary: 'Criar ou obter rascunho de NF-e para uma ordem',
  })
  async createOrGetDraft(@Req() req, @Param('orderId') orderId: string) {
    return this.nfeService.createOrGetDraft(req.user.companyId, orderId);
  }

  @Patch('draft/:id')
  @ApiOperation({ summary: 'Atualizar rascunho de NF-e' })
  async updateDraft(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: UpdateNfeDraftDto,
  ) {
    return this.nfeService.updateDraft(req.user.companyId, id, dto);
  }

  @Delete('draft/:id')
  @ApiOperation({ summary: 'Deletar rascunho de NF-e (cancelar digitação)' })
  async deleteDraft(@Req() req, @Param('id') id: string) {
    return this.nfeService.deleteDraft(req.user.companyId, id);
  }

  // ==================== NF-e Endpoints ====================

  @Get(':id')
  @ApiOperation({ summary: 'Obter NF-e por ID' })
  async findById(@Req() req, @Param('id') id: string) {
    return this.nfeService.findById(id, req.user.companyId);
  }

  @Post('emit')
  @RequireUnblocked()
  @ApiOperation({ summary: 'Emitir NF-e a partir de uma ordem de serviço' })
  async emit(@Req() req, @Body() dto: EmitNfeFromOrderDto) {
    return this.nfeService.emitFromOrder(req.user.companyId, dto);
  }

  @Post('emit-full')
  @RequireUnblocked()
  @ApiOperation({ summary: 'Emitir NF-e com todos os dados (manual)' })
  async emitFull(@Req() req, @Body() dto: EmitNfeDto) {
    return this.nfeService.emit(req.user.companyId, dto);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancelar NF-e' })
  async cancel(@Req() req, @Param('id') id: string, @Body() dto: CancelNfeDto) {
    return this.nfeService.cancel(id, req.user.companyId, dto);
  }

  @Post(':id/correction-letter')
  @ApiOperation({ summary: 'Enviar carta de correção' })
  async sendCorrectionLetter(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: CorrectionLetterDto,
  ) {
    return this.nfeService.sendCorrectionLetter(id, req.user.companyId, dto);
  }

  @Get(':id/status')
  @ApiOperation({ summary: 'Consultar status da NF-e' })
  async consultStatus(@Req() req, @Param('id') id: string) {
    return this.nfeService.consultStatus(id, req.user.companyId);
  }

  @Get(':id/danfe')
  @ApiOperation({ summary: 'Obter URL do DANFE' })
  async getDanfeUrl(@Req() req, @Param('id') id: string) {
    return this.nfeService.getDanfeUrl(id, req.user.companyId);
  }

  @Get(':id/xml')
  @ApiOperation({ summary: 'Obter XML da NF-e' })
  async getXml(@Req() req, @Param('id') id: string) {
    return this.nfeService.getXml(id, req.user.companyId);
  }
}
