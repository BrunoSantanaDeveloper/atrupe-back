import { HasPermission } from 'src/core/auth/abac/has-permission.decorator';
import { PermissionsGuard } from 'src/core/auth/abac/permissions.guard';
import { ValuesOnly } from 'src/core/auth/abac/money-fields.decorator';
import { ObservePermissions } from 'src/core/auth/abac/observe-permissions.decorator';
import {
  Controller,
  Post,
  Body,
  Patch,
  UseGuards,
  Req,
  Query,
  Get,
  Param,
} from '@nestjs/common';
import { CashControlService } from './cash-control.service';
import {
  CloseCashRegisterDto,
  CreateCashRegisterDto,
} from './dto/create-cash-control.dto';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { TenantGuard } from 'src/core/auth/guards/tenant.guard';
import { TenantResource } from 'src/core/auth/guards/tenant-resource.decorator';
import { FeatureGuard } from 'src/core/plan/guards/feature.guard';
import { RequiresFeature } from 'src/core/plan/decorators/requires-feature.decorator';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  EditCashRegisterDto,
  TransferDto,
} from './dto/update-cash-control.dto';
import { ListCashRegistersDto } from './dto/cash-control-filters.dto';
import { AbacService } from 'src/core/auth/abac/abac.service';
import { canViewValues } from 'src/core/auth/abac/values-visibility.interceptor';
import { CashDayService } from './cash-day.service';
import {
  CashAdjustmentDto,
  CashDayCloseDto,
  CashDayFilterDto,
  CashDayOpenDto,
  CashDayReopenDto,
  CashTransferDto,
} from './dto/cash-day.dto';

const RESOURCE = 'cash-control';
const GROUP = 'financial';

@ApiTags('Controle de Caixa')
// O controle de caixa inteiro é recurso de plano.
// O TenantGuard confere que o caixa da rota é da empresa da sessão: as rotas
// por id fechavam, reabriam, liam e lançavam no caixa de outra empresa
@UseGuards(JwtAuthGuard, FeatureGuard, TenantGuard, PermissionsGuard)
@RequiresFeature('cash_control')
@ApiBearerAuth()
// Permissão no endpoint em modo observar (Fase 2): a recusa vai para o log
// sem recusar, até a semana de log limpo; handler com
// @ObservePermissions(false) já recusa.
@ObservePermissions()
// Tudo aqui é valor: sem values:values:view a rota é recusada (por
// enquanto só observa, ver ValuesVisibilityInterceptor)
@ValuesOnly()
@Controller(`${GROUP}/${RESOURCE}`)
export class CashControlController {
  constructor(
    private readonly cashControlService: CashControlService,
    private readonly cashDay: CashDayService,
    private readonly abac: AbacService,
  ) {}

  /* ------------------------------------------------------------------
   * O caixa do dia (Fase 7.2, contrato seção 5): valores em centavos.
   * As rotas antigas (open, close/:id, reopen/:id, PATCH :id) seguem
   * para a tela antiga até ela sair. As novas já recusam sem permissão.
   * ------------------------------------------------------------------ */

  @Post('')
  @HasPermission('create', 'financial:cash_control')
  @ObservePermissions(false)
  @ApiOperation({ summary: 'Abre o caixa da conta num dia (FC-14)' })
  async openDay(@Req() req, @Body() dto: CashDayOpenDto) {
    return this.cashDay.open(
      req.user.companyId,
      dto,
      await this.cashDay.actorOf(req.user),
    );
  }

  @Post(':id/adjustment')
  @HasPermission('edit', 'financial:cash_control')
  @ObservePermissions(false)
  @TenantResource('cashRegister')
  @ApiOperation({ summary: 'Ajuste com motivo e plano de contas (CX-5)' })
  async adjust(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: CashAdjustmentDto,
  ) {
    return this.cashDay.adjust(
      req.user.companyId,
      id,
      dto,
      await this.cashDay.actorOf(req.user),
    );
  }

  @Post(':id/close')
  @HasPermission('edit', 'financial:cash_control')
  @ObservePermissions(false)
  @TenantResource('cashRegister')
  @ApiOperation({ summary: 'Fecha o dia com a contagem ou o extrato' })
  async closeDay(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: CashDayCloseDto,
  ) {
    return this.cashDay.close(
      req.user.companyId,
      id,
      dto,
      await this.cashDay.actorOf(req.user),
    );
  }

  @Post(':id/reopen')
  // Reabrir tem chave própria e restrita (ALT-7, decisão do PO)
  @HasPermission('edit', 'financial:cash_control_reopen')
  @ObservePermissions(false)
  @TenantResource('cashRegister')
  @ApiOperation({ summary: 'Reabre o caixa fechado com motivo' })
  async reopenDay(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: CashDayReopenDto,
  ) {
    return this.cashDay.reopen(
      req.user.companyId,
      id,
      dto,
      await this.cashDay.actorOf(req.user),
    );
  }

  @Post(':id/movement/:movementId/approve')
  @HasPermission('edit', 'financial:cash_control')
  @ObservePermissions(false)
  @TenantResource('cashRegister')
  @ApiOperation({ summary: 'Aprova o valor que chegou da frente de caixa' })
  async approveMovement(
    @Req() req,
    @Param('id') id: string,
    @Param('movementId') movementId: string,
  ) {
    return this.cashDay.approve(
      req.user.companyId,
      id,
      movementId,
      await this.cashDay.actorOf(req.user),
    );
  }

  @Get(':id/day')
  @HasPermission('view', 'financial:cash_control')
  @TenantResource('cashRegister')
  @ApiOperation({ summary: 'O caixa do dia, com os movimentos e os totais' })
  async dayDetail(@Req() req, @Param('id') id: string) {
    return this.cashDay.detail(req.user.companyId, id);
  }
  @Post('open')
  @HasPermission('create', 'financial:cash_control')
  async openCashRegister(
    @Req() req,
    @Body() createCashRegisterDto: CreateCashRegisterDto,
  ) {
    createCashRegisterDto.companyId = req.user.companyId;
    return this.cashControlService.openCashRegister(createCashRegisterDto);
  }

  @Patch('close/:cashRegisterId')
  @HasPermission('edit', 'financial:cash_control')
  @TenantResource('cashRegister', 'cashRegisterId')
  async closeCashRegister(
    @Param('cashRegisterId') cashRegisterId: string,
    @Body() closeCashRegisterDto: CloseCashRegisterDto,
  ) {
    closeCashRegisterDto.cashRegisterId = cashRegisterId;
    return this.cashControlService.closeCashRegister(closeCashRegisterDto);
  }

  @Get('quantity')
  // Só a contagem de caixas por situação
  @ValuesOnly(false)
  @HasPermission('view', 'financial:cash_control')
  @ApiOperation({
    summary:
      'Obtém a quantidade de todos os status de caixas abertos ou fechados.',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de quantidade de caixas retornada com sucesso.',
  })
  async findAllQuantity(@Req() req) {
    const companyId = req.user.companyId;
    return this.cashControlService.findAllQuantity(companyId);
  }

  @Get('')
  @HasPermission('view', 'financial:cash_control')
  async listCashRegisters(@Req() req, @Query() query: CashDayFilterDto) {
    // O formato antigo (data agrupada) segue para a tela antiga; o novo
    // vem ao lado: today, accounts, days, page, lastPage
    const old = await this.cashControlService.listCashRegisters({
      ...query,
      companyId: req.user.companyId,
    } as unknown as ListCashRegistersDto);
    const days = await this.cashDay.list(
      req.user.companyId,
      query,
      await canViewValues(req, this.abac),
    );
    return { ...old, ...days };
  }

  @Get(':id')
  @HasPermission('view', 'financial:cash_control')
  @ApiParam({
    name: 'id',
    description: 'ID do caixa',
    example: 'cashRegisterId123',
  })
  @TenantResource('cashRegister')
  async findOneCashRegister(@Param('id') id: string) {
    return this.cashControlService.findOneCashRegister(id);
  }

  @Patch(':cashRegisterId')
  @HasPermission('edit', 'financial:cash_control')
  @TenantResource('cashRegister', 'cashRegisterId')
  async editCashRegister(
    @Param('cashRegisterId') cashRegisterId: string,
    @Body() editDto: EditCashRegisterDto,
  ) {
    editDto.cashRegisterId = cashRegisterId;
    return this.cashControlService.editCashRegister(editDto);
  }

  @Post('transfer')
  @HasPermission('create', 'financial:cash_control')
  async transferFunds(@Req() req, @Body() dto: CashTransferDto) {
    // O corpo novo (fromId/toId, centavos) faz o par ligado (CX-2)
    if (dto.fromId || dto.toId) {
      return this.cashDay.transfer(
        req.user.companyId,
        dto,
        await this.cashDay.actorOf(req.user),
      );
    }
    return this.cashControlService.transferFunds(
      dto as unknown as TransferDto,
      req.user.companyId,
    );
  }

  @Post('reopen/:id')
  @HasPermission('edit', 'financial:cash_control')
  @TenantResource('cashRegister')
  async reopenCashRegister(@Req() req, @Param('id') id: string) {
    return this.cashControlService.reopenCashRegister(id);
  }
}
