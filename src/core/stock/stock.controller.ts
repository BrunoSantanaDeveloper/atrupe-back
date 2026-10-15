import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { PermissionsGuard } from '../auth/abac/permissions.guard';
import { HasPermission } from '../auth/abac/has-permission.decorator';
import { ObservePermissions } from '../auth/abac/observe-permissions.decorator';
import { MoneyFields } from '../auth/abac/money-fields.decorator';
import { AbacService } from '../auth/abac/abac.service';
import { canViewValues } from '../auth/abac/values-visibility.interceptor';
import { actorOfUser } from '../financial/cash-control/cash-ledger';
import { FeatureGuard } from '../plan/guards/feature.guard';
import { RequiresFeature } from '../plan/decorators/requires-feature.decorator';
import { PrismaService } from 'nestjs-prisma';
import { StockService } from './stock.service';
import {
  InvoiceEntryFilterDto,
  MatchInvoiceItemDto,
  StockAdjustmentDto,
  StockFilterDto,
  StockMinimumDto,
  StockMovementFilterDto,
} from './dto/stock.dto';

const UUID = new ParseUUIDPipe({ version: '4' });

/** O saldo e os movimentos do estoque (ES-2, ES-5, ES-6, FULL). */
@ApiTags('Estoque')
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionsGuard)
@RequiresFeature('stock_control')
@ApiBearerAuth()
// Rotas novas: a permissão já recusa
@ObservePermissions(false)
@Controller('stock')
export class StockController {
  constructor(
    private readonly stock: StockService,
    private readonly abac: AbacService,
    private readonly prisma: PrismaService,
  ) {}

  // O custo médio e o da última entrada só com a permissão de valores
  @Get()
  @HasPermission('view', 'stock:stock')
  @ApiOperation({ summary: 'Saldo do estoque, com mínimo e custo médio' })
  async list(@Req() req, @Query() filter: StockFilterDto) {
    return this.stock.list(
      req.user.companyId,
      filter,
      await canViewValues(req, this.abac),
    );
  }

  @Patch(':id/minimum')
  @HasPermission('edit', 'stock:stock')
  @ApiOperation({ summary: 'O mínimo do material no estoque' })
  minimum(
    @Req() req,
    @Param('id', UUID) id: string,
    @Body() dto: StockMinimumDto,
  ) {
    return this.stock.setMinimum(req.user.companyId, id, dto.minimum);
  }

  @Post(':id/adjustment')
  @HasPermission('edit', 'stock:stock')
  @ApiOperation({ summary: 'Ajuste de inventário pela contagem física' })
  async adjustment(
    @Req() req,
    @Param('id', UUID) id: string,
    @Body() dto: StockAdjustmentDto,
  ) {
    return this.stock.adjust(
      req.user.companyId,
      id,
      dto.counted,
      dto.reason,
      await actorOfUser(this.prisma, req.user),
    );
  }

  @Get('movement')
  @HasPermission('view', 'stock:stock')
  @ApiOperation({ summary: 'Movimentos do estoque, com a origem (ES-6)' })
  movements(@Req() req, @Query() filter: StockMovementFilterDto) {
    return this.stock.movements(req.user.companyId, filter);
  }
}

/** A entrada de nota: conciliação, de-para e entrada no estoque (ES-1, ES-3, ES-4). */
@ApiTags('Estoque')
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionsGuard)
@RequiresFeature('invoice_entry')
@ApiBearerAuth()
@ObservePermissions(false)
@Controller('stock/invoice-entry')
export class InvoiceEntryController {
  constructor(
    private readonly stock: StockService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @HasPermission('view', 'stock:invoice_entry')
  @MoneyFields('total', 'unitValue', 'entryCost')
  @ApiOperation({ summary: 'Notas de entrada com os itens e a conciliação' })
  list(@Req() req, @Query() filter: InvoiceEntryFilterDto) {
    return this.stock.invoices(req.user.companyId, filter);
  }

  // Fora do contrato: sem a entrada automática (ALT-20), a nota entra pelo
  // XML da NF-e que o fornecedor manda (Fase 7.5)
  @Post()
  @HasPermission('create', 'stock:invoice_entry')
  @MoneyFields('total', 'unitValue', 'entryCost')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Lança a nota pelo XML da NF-e' })
  create(@Req() req, @UploadedFile() file: Express.Multer.File) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Escolha o XML da NF-e');
    }
    return this.stock.importXml(
      req.user.companyId,
      file.buffer.toString('utf8'),
    );
  }

  @Patch(':id/item/:itemId')
  @HasPermission('edit', 'stock:invoice_entry')
  @MoneyFields('total', 'unitValue', 'entryCost')
  @ApiOperation({ summary: 'Concilia o item com o material e o fator (ES-3)' })
  match(
    @Req() req,
    @Param('id', UUID) id: string,
    @Param('itemId', UUID) itemId: string,
    @Body() dto: MatchInvoiceItemDto,
  ) {
    return this.stock.matchItem(req.user.companyId, id, itemId, dto);
  }

  @Post(':id/confirm')
  @HasPermission('edit', 'stock:invoice_entry')
  @MoneyFields('total', 'unitValue', 'entryCost', 'averageCost')
  @ApiOperation({ summary: 'Dá entrada da nota no estoque (ES-4, ES-5)' })
  async confirm(@Req() req, @Param('id', UUID) id: string) {
    return this.stock.confirm(
      req.user.companyId,
      id,
      await actorOfUser(this.prisma, req.user),
    );
  }
}
