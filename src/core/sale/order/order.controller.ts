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

const RESOURCE = 'order';

@ApiTags('Ordem de serviço')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller(`sale/${RESOURCE}`)
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

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
    return await this.orderService.findAll(query);
  }

  @Get('quantity')
  @ApiOperation({
    summary: 'Obtém a quantidade de todos os status de orçamentos',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de quantidade de orçamentos retornada com sucesso.',
  })
  async findAllQuantity(@Req() req) {
    const companyId = req.user.companyId;
    return this.orderService.findAllQuantity(companyId);
  }

  // @Post(':id/duplicate')
  // @ApiOperation({ summary: 'Duplica uma ordem de serviço pelo ID' })
  // @ApiParam({
  //   name: 'id',
  //   required: true,
  //   description: 'ID da ordem de serviço',
  // })
  // @ApiResponse({
  //   status: 200,
  //   description: 'Ordem de serviço duplicada com sucesso.',
  // })
  // @ApiResponse({
  //   status: 400,
  //   description: 'ID inválido.',
  // })
  // async duplicate(@Param('id') id: string) {
  //   if (!isUUID(id, '4')) {
  //     throw new BadRequestException('Invalid id');
  //   }

  //   return this.orderService.duplicate(id);
  // }

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
  findOne(@Param('id') id: string) {
    return this.orderService.findOne(id);
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
  async cancelOrder(@Param('id') id: string, @Body() dto: CancelOrderDto) {
    return this.orderService.cancelOrder(id, dto);
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
