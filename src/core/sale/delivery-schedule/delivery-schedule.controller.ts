import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Req,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { DeliveryScheduleService } from './delivery-schedule.service';
import { CreateDeliveryScheduleDto } from './dto/create-delivery-schedule.dto';
import { UpdateDeliveryScheduleDto } from './dto/update-delivery-schedule.dto';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { DeliveryScheduleFitlerDto } from './dto/filter.dto';
const RESOURCE = 'delivery-schedule';

@ApiTags('Agenda de entrega')
// @UseGuards(JwtAuthGuard)
// @ApiBearerAuth()
@Controller(`sale/${RESOURCE}`)
export class DeliveryScheduleController {
  constructor(
    private readonly deliveryScheduleService: DeliveryScheduleService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Criar um agendamento de entrega' })
  @ApiResponse({ status: 201, description: 'Agendamento criado com sucesso.' })
  create(@Body() createDeliveryScheduleDto: CreateDeliveryScheduleDto) {
    return this.deliveryScheduleService.create(createDeliveryScheduleDto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Obtém a lista de todos os agendamentos de entrega',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de orçamentos retornada com sucesso.',
    isArray: true,
  })
  async findAll(@Req() req, @Query() query: DeliveryScheduleFitlerDto) {
    query.companyId = req.user.companyId;
    return await this.deliveryScheduleService.findAll(query);
  }

  @Get('quantity')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Obtém a quantidade de todos os status de orçamentos',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de quantidade de orçamentos retornada com sucesso.',
  })
  async findAllQuantity(@Req() req) {
    const companyId = req.user.companyId;
    return this.deliveryScheduleService.findAllQuantity(companyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar um agendamento de entrega pelo ID' })
  findOne(@Param('id') id: string) {
    return this.deliveryScheduleService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar um agendamento de entrega' })
  update(
    @Param('id') id: string,
    @Body() updateDeliveryScheduleDto: UpdateDeliveryScheduleDto,
  ) {
    return this.deliveryScheduleService.update(id, updateDeliveryScheduleDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Excluir um agendamento de entrega' })
  remove(@Param('id') id: string) {
    return this.deliveryScheduleService.remove(id);
  }

  @Patch('finish/:deliveryScheduleId')
  @ApiOperation({ summary: 'Finalizar um agendamento de entrega' })
  @ApiResponse({
    status: 200,
    description: 'Agendamento de entrega finalizado com sucesso',
  })
  @ApiResponse({
    status: 404,
    description: 'Agendamento de entrega não encontrado',
  })
  @ApiResponse({
    status: 500,
    description: 'Erro interno ao finalizar agendamento',
  })
  async finish(@Param('deliveryScheduleId') deliveryScheduleId: string) {
    return await this.deliveryScheduleService.finishDeliverySchedule(
      deliveryScheduleId,
    );
  }
}
