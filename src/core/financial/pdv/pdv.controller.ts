import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { PermissionsGuard } from '../../auth/abac/permissions.guard';
import { HasPermission } from '../../auth/abac/has-permission.decorator';
import { ObservePermissions } from '../../auth/abac/observe-permissions.decorator';
import { AbacService } from '../../auth/abac/abac.service';
import { FeatureGuard } from '../../plan/guards/feature.guard';
import { RequiresFeature } from '../../plan/decorators/requires-feature.decorator';
import { PdvService } from './pdv.service';
import {
  BillSaleDto,
  CashFrontDto,
  CashSessionMovementDto,
  CloseCashSessionDto,
  OpenCashSessionDto,
  ReceiveSaleDto,
  SaleReasonDto,
} from './dto/pdv.dto';

const UUID = new ParseUUIDPipe({ version: '4' });

/**
 * A frente de caixa (FC-1 a FC-20, contrato seção 5). O operador vê os
 * valores do caixa sem `values:values:view` (FC-15). Rotas novas: a
 * permissão já recusa.
 */
@ApiTags('Frente de caixa')
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionsGuard)
@RequiresFeature('pdv_screen')
@ApiBearerAuth()
@ObservePermissions(false)
@Controller('financial/pdv')
export class PdvController {
  constructor(
    private readonly pdv: PdvService,
    private readonly abac: AbacService,
  ) {}

  @Get()
  @HasPermission('view', 'financial:pdv')
  @ApiOperation({ summary: 'A sessão do operador e a fila do caixa' })
  state(@Req() req) {
    return this.pdv.state(req.user);
  }

  // O cadastro das frentes (FC-15): ler é de quem usa a frente de caixa;
  // criar e mudar é "Configurar frente de caixa"
  @Get('front')
  @HasPermission('view', 'financial:pdv')
  @ApiOperation({ summary: 'As frentes de caixa da empresa' })
  fronts(@Req() req) {
    return this.pdv.listFronts(req.user.companyId);
  }

  @Post('front')
  @HasPermission('edit', 'financial:pdv_settings')
  @ApiOperation({ summary: 'Cria uma frente de caixa (FC-5, FC-15)' })
  createFront(@Req() req, @Body() dto: CashFrontDto) {
    return this.pdv.createFront(req.user.companyId, dto);
  }

  @Patch('front/:id')
  @HasPermission('edit', 'financial:pdv_settings')
  @ApiOperation({ summary: 'Muda o cadastro da frente (FC-7, FC-18)' })
  updateFront(
    @Req() req,
    @Param('id', UUID) id: string,
    @Body() dto: CashFrontDto,
  ) {
    return this.pdv.updateFront(req.user.companyId, id, dto);
  }

  @Post('session')
  @HasPermission('create', 'financial:pdv')
  @ApiOperation({ summary: 'Abre a sessão com o troco da gaveta (FC-14)' })
  async open(@Req() req, @Body() dto: OpenCashSessionDto) {
    return this.pdv.openSession(
      req.user,
      dto,
      await this.pdv.actorOf(req.user),
    );
  }

  @Post('session/:id/movement')
  @HasPermission('edit', 'financial:pdv')
  @ApiOperation({ summary: 'Sangria ou suprimento (FC-8)' })
  async movement(
    @Req() req,
    @Param('id', UUID) id: string,
    @Body() dto: CashSessionMovementDto,
  ) {
    return this.pdv.movement(
      req.user,
      id,
      dto,
      await this.pdv.actorOf(req.user),
    );
  }

  @Post('session/:id/close')
  @HasPermission('edit', 'financial:pdv')
  @ApiOperation({ summary: 'Fecha a sessão e leva o recebido às contas' })
  async close(
    @Req() req,
    @Param('id', UUID) id: string,
    @Body() dto: CloseCashSessionDto,
  ) {
    return this.pdv.close(req.user, id, dto, await this.pdv.actorOf(req.user));
  }

  @Post('sale/:id/claim')
  @HasPermission('edit', 'financial:pdv')
  @ApiOperation({ summary: 'Puxa a venda para este caixa (FC-5)' })
  claim(@Req() req, @Param('id', UUID) id: string) {
    return this.pdv.claim(req.user, id);
  }

  @Delete('sale/:id/claim')
  @HasPermission('edit', 'financial:pdv')
  @ApiOperation({ summary: 'Devolve a venda à fila (FC-5)' })
  release(@Req() req, @Param('id', UUID) id: string) {
    return this.pdv.release(req.user, id);
  }

  @Post('sale/:id/receive')
  @HasPermission('edit', 'financial:pdv')
  @ApiOperation({ summary: 'Recebe a venda: misto, troco, sinal (FC-9)' })
  async receive(
    @Req() req,
    @Param('id', UUID) id: string,
    @Body() dto: ReceiveSaleDto,
  ) {
    const canWaive = dto.waiveDownPayment
      ? await this.abac.hasPermission(
          req.user,
          'edit',
          'financial:pdv_down_payment',
        )
      : false;
    return this.pdv.receive(
      req.user,
      id,
      dto,
      await this.pdv.actorOf(req.user),
      canWaive,
    );
  }

  @Post('sale/:id/ready')
  @HasPermission('edit', 'financial:pdv')
  @ApiOperation({ summary: 'Trabalho pronto, aguardando retirada (FC-19)' })
  ready(@Req() req, @Param('id', UUID) id: string) {
    return this.pdv.ready(req.user, id);
  }

  @Post('sale/:id/discard')
  @HasPermission('delete', 'financial:pdv')
  @ApiOperation({ summary: 'Descarta o trabalho não retirado (FC-19)' })
  async discard(
    @Req() req,
    @Param('id', UUID) id: string,
    @Body() dto: SaleReasonDto,
  ) {
    return this.pdv.discard(
      req.user,
      id,
      dto.reason,
      await this.pdv.actorOf(req.user),
    );
  }

  // Cancelar venda paga é permissão restrita (FC-15): a de excluir
  @Post('sale/:id/reverse')
  @HasPermission('delete', 'financial:pdv')
  @ApiOperation({ summary: 'Cancela a venda com estorno (FC-13, ALT-7)' })
  async reverse(
    @Req() req,
    @Param('id', UUID) id: string,
    @Body() dto: SaleReasonDto,
  ) {
    return this.pdv.reverse(
      req.user,
      id,
      dto.reason,
      await this.pdv.actorOf(req.user),
    );
  }

  @Post('sale/:id/bill')
  @HasPermission('edit', 'financial:pdv_billing')
  @ApiOperation({ summary: 'Reverte a venda rápida para faturamento (FC-4)' })
  async bill(
    @Req() req,
    @Param('id', UUID) id: string,
    @Body() dto: BillSaleDto,
  ) {
    return this.pdv.bill(req.user, id, dto, await this.pdv.actorOf(req.user));
  }
}
