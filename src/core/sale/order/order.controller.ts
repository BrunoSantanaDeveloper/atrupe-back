import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { OrderService } from './order.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { FilterOrderDto } from './dto/filter.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { isUUID } from 'class-validator';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';

const RESOURCE = 'order';

@ApiTags('Ordem de serviço')
@UseGuards(JwtAuthGuard)
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
  @ApiQuery({ name: 'filter', type: FilterOrderDto, required: false })
  @ApiResponse({
    status: 200,
    description: 'Lista de ordens de serviço retornada com sucesso.',
    isArray: true,
  })
  findAll(@Query() query: FilterOrderDto) {
    return this.orderService.findAll(query);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancela uma ordem de serviço pelo ID' })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID da ordem de serviço',
  })
  @ApiResponse({
    status: 200,
    description: 'Ordem de serviço cancelada com sucesso.',
  })
  @ApiResponse({
    status: 400,
    description: 'ID inválido.',
  })
  async cancel(@Param('id') id: string) {
    if (!isUUID(id, '4')) {
      throw new BadRequestException('Invalid id');
    }

    return this.orderService.cancel(id);
  }

  @Post(':id/duplicate')
  @ApiOperation({ summary: 'Duplica uma ordem de serviço pelo ID' })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID da ordem de serviço',
  })
  @ApiResponse({
    status: 200,
    description: 'Ordem de serviço duplicada com sucesso.',
  })
  @ApiResponse({
    status: 400,
    description: 'ID inválido.',
  })
  async duplicate(@Param('id') id: string) {
    if (!isUUID(id, '4')) {
      throw new BadRequestException('Invalid id');
    }

    return this.orderService.duplicate(id);
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
  findOne(@Param('id') id: string) {
    return this.orderService.findOne(id);
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
