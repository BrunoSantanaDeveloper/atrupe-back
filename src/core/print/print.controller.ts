import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { HasAnyPermission } from '../auth/abac/has-any-permission.decorator';
import { HasPermission } from '../auth/abac/has-permission.decorator';
import { PermissionsGuard } from '../auth/abac/permissions.guard';
import { FeatureGuard } from '../plan/guards/feature.guard';
import { RequiresFeature } from '../plan/decorators/requires-feature.decorator';
import { PrintCountQueryDto, SavePrintSettingsDto } from './print.dto';
import { PrintService } from './print.service';

const PRODUCTS = 'product_settings:products';

const ProductId = new ParseUUIDPipe({
  exceptionFactory: () => new NotFoundException('Produto não encontrado'),
});

// Quem lê: o cadastro e o orçamento, que mostra a contagem no item
const READERS = [
  { action: 'view', resource: PRODUCTS },
  { action: 'create', resource: 'sale:quotation' },
  { action: 'edit', resource: 'sale:quotation' },
];

/**
 * Gráfica rápida no LITE (12/11/2026): sangria variável, folhas de acerto,
 * bloco por folhas × vias e apostila por seções, com o recurso
 * `paper_register` (Papéis). A contagem não tem custo nem preço.
 */
@ApiTags('Produtos: impressão (gráfica rápida)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, FeatureGuard)
@RequiresFeature('paper_register')
@Controller('product')
export class PrintController {
  constructor(private readonly service: PrintService) {}

  @Get(':id/print-settings')
  @HasAnyPermission(...READERS)
  @ApiOperation({ summary: 'A impressão do produto: tipo, sangria, acerto' })
  settings(@Req() req, @Param('id', ProductId) id: string) {
    return this.service.settings(req.user.companyId, id);
  }

  @Put(':id/print-settings')
  @HasPermission('edit', PRODUCTS)
  @ApiOperation({ summary: 'Grava a impressão do produto' })
  save(
    @Req() req,
    @Param('id', ProductId) id: string,
    @Body() dto: SavePrintSettingsDto,
  ) {
    return this.service.save(req.user.companyId, id, dto);
  }

  @Post(':id/print-count')
  @HttpCode(200)
  @HasAnyPermission(...READERS)
  @ApiOperation({ summary: 'A prévia da contagem de folhas do item' })
  preview(
    @Req() req,
    @Param('id', ProductId) id: string,
    @Body() dto: PrintCountQueryDto,
  ) {
    return this.service.preview(req.user.companyId, id, dto);
  }
}
