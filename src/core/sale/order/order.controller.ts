import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Query,
  UseGuards,
  Req,
  NotFoundException,
} from '@nestjs/common';
import { OrderService } from './order.service';
import { CancelOrderDto, CreateOrderDto } from './dto/create-order.dto';
import { FilterOrderDto } from './dto/filter.dto';
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

const RESOURCE = 'order';

@ApiTags('Ordem de serviço')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller(`sale/${RESOURCE}`)
export class OrderController {
  constructor(
    private readonly orderService: OrderService,
    private readonly abacService: AbacService,
  ) {}

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

    // Verificar se o usuário pode ver ordens de outros vendedores
    const canSeeOtherOrders = await this.abacService.hasPermission(
      req.user,
      'view',
      'sale:other_quotation',
    );

    if (!canSeeOtherOrders && !req.user.isAdmin && req.user.employeeId) {
      query.sellerId = req.user.employeeId;
    }

    return await this.orderService.findAll(query);
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
    const canSeeOtherOrders = await this.abacService.hasPermission(
      req.user,
      'view',
      'sale:other_quotation',
    );

    let sellerId: string | undefined;
    if (!canSeeOtherOrders && !req.user.isAdmin && req.user.employeeId) {
      sellerId = req.user.employeeId;
    }

    return this.orderService.findAllQuantity(companyId, sellerId);
  }

  @Get(':id')
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
    const order = await this.orderService.findOne(id);

    if (!order) {
      throw new NotFoundException('Ordem de serviço não encontrada');
    }

    // Verificar se a ordem pertence à empresa do usuário
    if (order.companyId !== req.user.companyId) {
      throw new NotFoundException('Ordem de serviço não encontrada');
    }

    // Verificar se o usuário pode ver ordens de outros vendedores
    const canSeeOtherOrders = await this.abacService.hasPermission(
      req.user,
      'view',
      'sale:other_quotation',
    );

    // Se não pode ver ordens de outros, verificar se é o dono
    if (!canSeeOtherOrders && !req.user.isAdmin && req.user.employeeId) {
      if (order.sellerId !== req.user.employeeId) {
        throw new NotFoundException('Ordem de serviço não encontrada');
      }
    }

    return order;
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
