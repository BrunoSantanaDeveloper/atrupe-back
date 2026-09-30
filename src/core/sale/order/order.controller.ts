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
import { CancelOrderDto, CreateOrderDto } from './dto/create-order.dto';
import { FilterOrderDto } from './dto/filter.dto';
import { UpdateOrderInfoDto } from './dto/update-order.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AbacService } from '../../auth/abac/abac.service';
import { PlanControlService } from '../../plan/plan-control.service';
import { isUUID } from 'class-validator';

const RESOURCE = 'order';
const UUID_ROUTE = ':id([0-9a-fA-F-]{36})';

@ApiTags('Ordem de serviço')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
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

  @Post()
  @ApiOperation({ summary: 'Cria uma nova ordem de serviço' })
  @ApiBody({
    description: 'Dados da nova ordem de serviço',
    type: CreateOrderDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Ordem de serviço criada com sucesso.',
  })
  create(@Body() createOrderDto: CreateOrderDto) {
    return this.orderService.create(createOrderDto);
  }

  @Get()
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
  @ApiOperation({
    summary: 'ObtÃ©m as ordens de serviÃ§o filtradas para exportaÃ§Ã£o',
  })
  @ApiResponse({
    status: 200,
    description:
      'Lista de ordens de serviÃ§o para exportaÃ§Ã£o retornada com sucesso.',
  })
  async export(@Req() req, @Query() query: FilterOrderDto) {
    const canExport = await this.abacService.hasPermission(
      req.user,
      'export',
      'sale:order',
    );

    if (!canExport) {
      throw new ForbiddenException(
        'Sem permissÃ£o para exportar ordens de serviÃ§o',
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
    // Cancelar com motivo é recurso de plano; sem motivo é livre.
    if (dto.reasonId) {
      await this.planControlService.enforceFeature(
        req.user.companyId,
        'service_order_cancellation_reason',
      );
    }
    return this.orderService.cancelOrder(id, dto, req.user.userId);
  }

  @Delete(':id')
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
