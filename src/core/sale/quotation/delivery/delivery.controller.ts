import {
  Controller,
  Post,
  Body,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { DeliveryService } from './delivery.service';
import { CreateDeliveryInfoDto } from './dto/create-delivery.dto';
import { UpdateDeliveryInfoDto } from './dto/update-delivery.dto';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
const RESOURCE = 'delivery';
const GROUP = 'quotation';

@ApiTags('Informações de entrega de orçamentos')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller(`${GROUP}/${RESOURCE}`)
export class DeliveryController {
  constructor(private readonly deliveryService: DeliveryService) {}

  @ApiOperation({
    summary: 'Criação de informações de entrega para um orçamento',
  })
  @ApiResponse({
    status: 201,
    description: 'Entrega criada com sucesso.',
  })
  @Post(':quotationId')
  async createDeliveryInfo(
    @Param('quotationId') quotationId: string,
    @Body() createDeliveryInfoDto: CreateDeliveryInfoDto,
  ) {
    return this.deliveryService.createDeliveryInfo(
      quotationId,
      createDeliveryInfoDto,
    );
  }

  @ApiOperation({
    summary: 'Edição das informações de entrega de um orçamento',
  })
  @ApiResponse({
    status: 200,
    description: 'Entrega atualizada com sucesso.',
  })
  @Patch(':id')
  async updateDeliveryInfo(
    @Param('id') id: string,
    @Body() updateDeliveryInfoDto: UpdateDeliveryInfoDto,
  ) {
    return this.deliveryService.updateDeliveryInfo(id, updateDeliveryInfoDto);
  }
}
