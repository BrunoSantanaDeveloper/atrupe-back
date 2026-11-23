import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from 'nestjs-prisma';
import { HasPermission } from '../../auth/abac/has-permission.decorator';
import { MoneyFields } from '../../auth/abac/money-fields.decorator';
import { ObservePermissions } from '../../auth/abac/observe-permissions.decorator';
import { PermissionsGuard } from '../../auth/abac/permissions.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { actorOfUser } from '../../financial/cash-control/cash-ledger';
import { RequiresFeature } from '../../plan/decorators/requires-feature.decorator';
import { FeatureGuard } from '../../plan/guards/feature.guard';
import {
  CancelDto,
  CheckOrderDto,
  CloseOrderDto,
  LotOpenDto,
  LotSplitDto,
  LotUseDto,
  PayablesDto,
  PurchaseOrderDto,
  PurchaseOrderFilterDto,
  PurchaseQuoteDto,
  PurchaseRequestDto,
  PurchaseRequestFilterDto,
  ReceiveOrderDto,
  StockLotDto,
  StockLotFilterDto,
} from './purchasing.dto';
import { PurchasingService } from './purchasing.service';
import { StockLotService } from './stock-lot.service';

const UUID = new ParseUUIDPipe({ version: '4' });
const REQUEST = 'stock:purchase_request';
const PURCHASE = 'stock:purchase';
const LOT = 'stock:lot';

/**
 * As compras do FULL (chave purchasing): a solicitação (aberta a quem tem
 * stock:purchase_request), a cotação e o pedido (stock:purchase).
 */
@ApiTags('Compras')
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionsGuard)
@RequiresFeature('purchasing')
@ApiBearerAuth()
@ObservePermissions(false)
@Controller('stock/purchase')
export class PurchasingController {
  constructor(
    private readonly purchasing: PurchasingService,
    private readonly prisma: PrismaService,
  ) {}

  private actor(req) {
    return actorOfUser(this.prisma, req.user);
  }

  @Get('request')
  @HasPermission('view', REQUEST)
  @MoneyFields('unitPrice', 'total')
  @ApiOperation({
    summary: 'As solicitações de material, com a linha do tempo',
  })
  async requests(@Req() req, @Query() filter: PurchaseRequestFilterDto) {
    return this.purchasing.requests(
      req.user.companyId,
      filter,
      await this.actor(req),
    );
  }

  @Post('request')
  @HasPermission('create', REQUEST)
  @ApiOperation({ summary: 'Solicita um material (ES-14, ES-17)' })
  async createRequest(@Req() req, @Body() dto: PurchaseRequestDto) {
    return this.purchasing.createRequest(
      req.user.companyId,
      dto,
      await this.actor(req),
    );
  }

  @Post('request/:id/cancel')
  @HasPermission('edit', REQUEST)
  @ApiOperation({ summary: 'Cancela a solicitação, com o motivo' })
  async cancelRequest(
    @Req() req,
    @Param('id', UUID) id: string,
    @Body() dto: CancelDto,
  ) {
    return this.purchasing.cancelRequest(
      req.user.companyId,
      id,
      dto.reason,
      await this.actor(req),
    );
  }

  @Post('request/:id/quote')
  @HasPermission('edit', PURCHASE)
  @MoneyFields('unitPrice', 'total')
  @ApiOperation({ summary: 'Lança a cotação de um fornecedor' })
  async addQuote(
    @Req() req,
    @Param('id', UUID) id: string,
    @Body() dto: PurchaseQuoteDto,
  ) {
    return this.purchasing.addQuote(
      req.user.companyId,
      id,
      dto,
      await this.actor(req),
    );
  }

  @Delete('request/:id/quote/:quoteId')
  @HasPermission('edit', PURCHASE)
  @ApiOperation({ summary: 'Tira a cotação que não virou pedido' })
  removeQuote(
    @Req() req,
    @Param('id', UUID) id: string,
    @Param('quoteId', UUID) quoteId: string,
  ) {
    return this.purchasing.removeQuote(req.user.companyId, id, quoteId);
  }

  @Post('order/close')
  @HasPermission('edit', PURCHASE)
  @ApiOperation({
    summary: 'Fecha o pedido: as cotações escolhidas viram pedidos',
  })
  async closeOrder(@Req() req, @Body() dto: CloseOrderDto) {
    return this.purchasing.closeOrder(
      req.user.companyId,
      dto,
      await this.actor(req),
    );
  }

  @Get('order')
  @HasPermission('view', PURCHASE)
  @MoneyFields('unitPrice', 'total')
  @ApiOperation({ summary: 'Os pedidos de compra' })
  orders(@Req() req, @Query() filter: PurchaseOrderFilterDto) {
    return this.purchasing.orders(req.user.companyId, filter);
  }

  @Post('order')
  @HasPermission('edit', PURCHASE)
  @ApiOperation({ summary: 'Pedido de compra direto, sem cotação' })
  async createOrder(@Req() req, @Body() dto: PurchaseOrderDto) {
    return this.purchasing.createOrder(
      req.user.companyId,
      dto,
      await this.actor(req),
    );
  }

  @Get('order/:id/invoices')
  @HasPermission('view', PURCHASE)
  @MoneyFields('unitValue', 'total')
  @ApiOperation({ summary: 'As notas do fornecedor para a conferência' })
  invoices(@Req() req, @Param('id', UUID) id: string) {
    return this.purchasing.invoicesFor(req.user.companyId, id);
  }

  @Post('order/:id/deliver')
  @HasPermission('edit', PURCHASE)
  @ApiOperation({ summary: 'Confirma a entrega' })
  async deliver(@Req() req, @Param('id', UUID) id: string) {
    return this.purchasing.deliver(
      req.user.companyId,
      id,
      await this.actor(req),
    );
  }

  @Post('order/:id/check')
  @HasPermission('edit', PURCHASE)
  @ApiOperation({ summary: 'Confere a entrega (ES-13)' })
  async check(
    @Req() req,
    @Param('id', UUID) id: string,
    @Body() dto: CheckOrderDto,
  ) {
    return this.purchasing.check(
      req.user.companyId,
      id,
      dto,
      await this.actor(req),
    );
  }

  @Post('order/:id/receive')
  @HasPermission('edit', PURCHASE)
  @ApiOperation({ summary: 'Lança no estoque, com os lotes' })
  async receive(
    @Req() req,
    @Param('id', UUID) id: string,
    @Body() dto: ReceiveOrderDto,
  ) {
    return this.purchasing.receive(
      req.user.companyId,
      id,
      dto,
      await this.actor(req),
    );
  }

  @Post('order/:id/payables')
  @HasPermission('edit', PURCHASE)
  @ApiOperation({ summary: 'Gera as contas a pagar do pedido (ES-15)' })
  async payables(
    @Req() req,
    @Param('id', UUID) id: string,
    @Body() dto: PayablesDto,
  ) {
    return this.purchasing.payables(
      req.user.companyId,
      id,
      dto,
      await this.actor(req),
    );
  }

  @Post('order/:id/cancel')
  @HasPermission('edit', PURCHASE)
  @ApiOperation({ summary: 'Cancela o pedido; as solicitações voltam' })
  async cancelOrder(
    @Req() req,
    @Param('id', UUID) id: string,
    @Body() dto: CancelDto,
  ) {
    return this.purchasing.cancelOrder(
      req.user.companyId,
      id,
      dto.reason,
      await this.actor(req),
    );
  }
}

/** O estoque por lote (ES-8 a ES-12). */
@ApiTags('Compras')
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionsGuard)
@RequiresFeature('purchasing')
@ApiBearerAuth()
@ObservePermissions(false)
@Controller('stock/lot')
export class StockLotController {
  constructor(
    private readonly lots: StockLotService,
    private readonly prisma: PrismaService,
  ) {}

  private actor(req) {
    return actorOfUser(this.prisma, req.user);
  }

  @Get()
  @HasPermission('view', LOT)
  @MoneyFields('cost', 'unitCost', 'currentValue')
  @ApiOperation({ summary: 'Os lotes: ativos, encerrados ou todos' })
  list(@Req() req, @Query() filter: StockLotFilterDto) {
    return this.lots.list(req.user.companyId, filter);
  }

  @Post()
  @HasPermission('edit', LOT)
  @ApiOperation({ summary: 'Lança um lote à mão' })
  async create(@Req() req, @Body() dto: StockLotDto) {
    return this.lots.create(req.user.companyId, dto, await this.actor(req));
  }

  @Post(':id/open')
  @HasPermission('edit', LOT)
  @ApiOperation({ summary: 'Abre o lote num setor (a impressão)' })
  async open(
    @Req() req,
    @Param('id', UUID) id: string,
    @Body() dto: LotOpenDto,
  ) {
    return this.lots.open(req.user.companyId, id, dto, await this.actor(req));
  }

  @Post(':id/move')
  @HasPermission('edit', LOT)
  @ApiOperation({ summary: 'Leva o lote aberto para outro setor' })
  async move(
    @Req() req,
    @Param('id', UUID) id: string,
    @Body() dto: LotOpenDto,
  ) {
    return this.lots.move(req.user.companyId, id, dto, await this.actor(req));
  }

  @Post(':id/use')
  @HasPermission('edit', LOT)
  @ApiOperation({ summary: 'Dá baixa no lote' })
  async use(@Req() req, @Param('id', UUID) id: string, @Body() dto: LotUseDto) {
    return this.lots.use(req.user.companyId, id, dto, await this.actor(req));
  }

  @Post(':id/split')
  @HasPermission('edit', LOT)
  @ApiOperation({ summary: 'Divide o lote (ES-10)' })
  async split(
    @Req() req,
    @Param('id', UUID) id: string,
    @Body() dto: LotSplitDto,
  ) {
    return this.lots.split(req.user.companyId, id, dto, await this.actor(req));
  }

  @Post(':id/finish')
  @HasPermission('edit', LOT)
  @ApiOperation({ summary: 'Finaliza o lote' })
  async finish(@Req() req, @Param('id', UUID) id: string) {
    return this.lots.finish(req.user.companyId, id, await this.actor(req));
  }

  @Post(':id/cancel')
  @HasPermission('edit', LOT)
  @ApiOperation({ summary: 'Cancela o lote, com o motivo' })
  async cancel(
    @Req() req,
    @Param('id', UUID) id: string,
    @Body() dto: CancelDto,
  ) {
    return this.lots.cancel(
      req.user.companyId,
      id,
      dto.reason,
      await this.actor(req),
    );
  }
}
