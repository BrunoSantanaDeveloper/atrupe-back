import { HasPermission } from 'src/core/auth/abac/has-permission.decorator';
import { ObservePermissions } from 'src/core/auth/abac/observe-permissions.decorator';
import { HasAnyPermission } from 'src/core/auth/abac/has-any-permission.decorator';
import { PermissionsGuard } from 'src/core/auth/abac/permissions.guard';
import { MoneyFields } from 'src/core/auth/abac/money-fields.decorator';
import { ORDER_MONEY_FIELDS } from 'src/core/auth/abac/money-fields';
import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Delete,
  Query,
  UseGuards,
  Req,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { OrderService } from './order.service';
import { assertCancelReason } from './cancel-reason';
import { CancelOrderDto } from './dto/create-order.dto';
import { FilterOrderDto } from './dto/filter.dto';
import { UpdateOrderInfoDto } from './dto/update-order.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { TenantGuard } from '../../auth/guards/tenant.guard';
import { TenantResource } from '../../auth/guards/tenant-resource.decorator';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AbacService } from '../../auth/abac/abac.service';
import { PlanControlService } from '../../plan/plan-control.service';
import { isUUID } from 'class-validator';

const RESOURCE = 'order';
const UUID_ROUTE = ':id([0-9a-fA-F-]{36})';

@ApiTags('Ordem de serviço')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
// Permissão no endpoint em modo observar (Fase 2): a recusa vai para o log
// sem recusar, até a semana de log limpo; handler com
// @ObservePermissions(false) já recusa.
@ObservePermissions()
@Controller(`sale/${RESOURCE}`)
export class OrderController {
  constructor(
    private readonly orderService: OrderService,
    private readonly abacService: AbacService,
    private readonly planControlService: PlanControlService,
  ) {}

  /**
   * Aba de O.S. no cadastro de cliente (filtro por clientId) é feature do
   * plano Lite (client_additional_tabs). Impõe o paywall no backend, já que o
   * filtro por cliente só é usado por essa aba.
   */
  private async enforceClientTabsFeature(query: {
    companyId: string;
    clientId?: string;
  }) {
    if (query.clientId) {
      await this.planControlService.enforceFeature(
        query.companyId,
        'client_additional_tabs',
      );
    }
  }

  // POST /sale/order saiu (14/10): a O.S. nasce na aprovação do orçamento
  // e nenhuma tela criava O.S. avulsa

  @Get()
  @MoneyFields(...ORDER_MONEY_FIELDS)
  @HasPermission('view', 'sale:order')
  @ApiOperation({ summary: 'Obtém a lista de todas as ordens de serviço' })
  @ApiResponse({
    status: 200,
    description: 'Lista de ordens de serviço retornada com sucesso.',
    isArray: true,
  })
  async findAll(@Req() req, @Query() query: FilterOrderDto) {
    query.companyId = req.user.companyId;

    await this.enforceClientTabsFeature(query);

    // Verificar se o usuário pode ver ordens de outros vendedores
    const canSeeOtherOrders = await this.abacService.canAccessOtherSellers(
      req.user,
    );

    if (!canSeeOtherOrders && !req.user.isAdmin && req.user.employeeId) {
      query.sellerId = req.user.employeeId;
    }

    return await this.orderService.findAll(query);
  }

  @Get('export')
  @MoneyFields(...ORDER_MONEY_FIELDS)
  @ApiOperation({
    summary: 'Obtém as ordens de serviço filtradas para exportação',
  })
  @ApiResponse({
    status: 200,
    description:
      'Lista de ordens de serviço para exportação retornada com sucesso.',
  })
  async export(@Req() req, @Query() query: FilterOrderDto) {
    const canExport = await this.abacService.hasPermission(
      req.user,
      'export',
      'sale:order',
    );

    if (!canExport) {
      throw new ForbiddenException(
        'Sem permissão para exportar ordens de serviço',
      );
    }

    query.companyId = req.user.companyId;

    await this.enforceClientTabsFeature(query);

    const canSeeOtherOrders = await this.abacService.canAccessOtherSellers(
      req.user,
    );

    if (!canSeeOtherOrders && !req.user.isAdmin && req.user.employeeId) {
      query.sellerId = req.user.employeeId;
    }

    return await this.orderService.findAllForExport(query);
  }

  @Get('quantity')
  @HasPermission('view', 'sale:order')
  @ApiOperation({
    summary: 'Obtém a quantidade de todos os status de ordens',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de quantidade de ordens retornada com sucesso.',
  })
  async findAllQuantity(@Req() req) {
    const companyId = req.user.companyId;

    // Verificar se o usuário pode ver ordens de outros vendedores
    const canSeeOtherOrders = await this.abacService.canAccessOtherSellers(
      req.user,
    );

    let sellerId: string | undefined;
    if (!canSeeOtherOrders && !req.user.isAdmin && req.user.employeeId) {
      sellerId = req.user.employeeId;
    }

    return this.orderService.findAllQuantity(companyId, sellerId);
  }

  @Get(UUID_ROUTE)
  @MoneyFields(...ORDER_MONEY_FIELDS)
  @HasAnyPermission(
    { action: 'view', resource: 'sale:order' },
    { action: 'create', resource: 'nota_fiscal:emitir' },
  )
  @ApiOperation({ summary: 'Obtém uma ordem de serviço pelo ID' })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID da ordem de serviço',
  })
  @ApiResponse({
    status: 200,
    description: 'Ordem de serviço retornada com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Ordem de serviço não encontrada.',
  })
  async findOne(@Param('id') id: string, @Req() req) {
    if (!isUUID(id, '4')) {
      throw new BadRequestException('Invalid id');
    }

    const order = await this.orderService.findOne(id);

    if (!order) {
      throw new NotFoundException('Ordem de serviço não encontrada');
    }

    // Verificar se a ordem pertence à empresa do usuário
    if (order.companyId !== req.user.companyId) {
      throw new NotFoundException('Ordem de serviço não encontrada');
    }

    // Verificar se o usuário pode ver ordens de outros vendedores
    const canSeeOtherOrders = await this.abacService.canAccessOtherSellers(
      req.user,
    );

    // Se não pode ver ordens de outros, verificar se é o dono
    if (!canSeeOtherOrders && !req.user.isAdmin && req.user.employeeId) {
      if (order.sellerId !== req.user.employeeId) {
        throw new NotFoundException('Ordem de serviço não encontrada');
      }
    }

    return order;
  }

  @Patch(':id/info')
  @HasPermission('edit', 'sale:order')
  @UseGuards(TenantGuard)
  @TenantResource('order', 'id', 'quotation')
  @ApiOperation({
    summary:
      'Editar informações da OS (cliente, vendedor, responsável, endereço)',
  })
  @ApiResponse({ status: 200, description: 'Ordem atualizada com sucesso.' })
  @ApiResponse({ status: 400, description: 'Dados inválidos ou OS cancelada.' })
  @ApiResponse({ status: 404, description: 'Ordem não encontrada.' })
  async updateOrderInfo(
    @Param('id') id: string,
    @Body() dto: UpdateOrderInfoDto,
    @Req() req,
  ) {
    // Trocar a série renumera a OS: restrito ao admin da conta, como no orçamento.
    if (!req.user?.isAdmin) delete dto.seriesId;
    return this.orderService.updateOrderInfo(id, dto, req.user.userId);
  }

  @Post(':id/cancel')
  @HasAnyPermission(
    { action: 'edit', resource: 'sale:order' },
    { action: 'delete', resource: 'sale:order' },
  )
  @UseGuards(TenantGuard)
  @TenantResource('order', 'id', 'quotation')
  @ApiOperation({ summary: 'Cancelar uma ordem de serviço' })
  @ApiResponse({ status: 200, description: 'Ordem cancelada com sucesso.' })
  @ApiResponse({ status: 404, description: 'Motivo ou ordem não encontrada.' })
  @ApiResponse({
    status: 400,
    description: 'Erro na validação ou no banco de dados.',
  })
  @ApiResponse({ status: 500, description: 'Erro interno no servidor.' })
  async cancelOrder(
    @Param('id') id: string,
    @Body() dto: CancelOrderDto,
    @Req() req,
  ) {
    // O motivo: obrigatório com o cadastro de motivos no plano e algum
    // motivo cadastrado (a mesma regra de refazer a O.S.)
    await assertCancelReason(
      this.planControlService,
      (companyId) => this.orderService.countCancelReasons(companyId),
      req.user.companyId,
      dto.reasonId,
    );
    return this.orderService.cancelOrder(id, dto, req.user.userId);
  }

  @Delete(':id')
  @HasPermission('delete', 'sale:order')
  // Sem uso no front e destrutiva: já recusa, sem passar pelo modo observar
  @ObservePermissions(false)
  @UseGuards(TenantGuard)
  @TenantResource('order', 'id', 'quotation')
  @ApiOperation({ summary: 'Remove uma ordem de serviço pelo ID' })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID da ordem de serviço',
  })
  @ApiResponse({
    status: 200,
    description: 'Ordem de serviço removida com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Ordem de serviço não encontrada.',
  })
  remove(@Param('id') id: string) {
    return this.orderService.remove(id);
  }
}
