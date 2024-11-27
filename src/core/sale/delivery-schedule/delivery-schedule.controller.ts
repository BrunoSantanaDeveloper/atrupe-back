import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
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
const RESOURCE = 'delivery-schedule';

@ApiTags('Agenda de entrega')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
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
  @ApiOperation({ summary: 'Listar todos os agendamentos de entrega' })
  findAll() {
    return this.deliveryScheduleService.findAll();
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
}
