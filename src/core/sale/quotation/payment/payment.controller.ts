import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { PaymentService } from './payment.service';

import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { UpdateQuotationPaymentDto } from './dto/update-payment.dto';

const RESOURCE = 'payment';
const GROUP = 'quotation';

@ApiTags('Informações de pagamento do orçamento')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller(`${GROUP}/${RESOURCE}`)
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Get(':id')
  @ApiOperation({
    summary: 'Buscar informações de pagamento de um orçamento pelo ID',
  })
  @ApiParam({ name: 'id', description: 'ID do registro de pagamento' })
  async findOne(@Param('id') id: string) {
    return this.paymentService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Atualizar as informações de pagamento de um orçamento',
  })
  @ApiParam({
    name: 'id',
    description: 'ID do registro de pagamento a ser atualizado',
  })
  async update(
    @Param('id') id: string,
    @Body() updateQuotationPaymentDto: UpdateQuotationPaymentDto,
  ) {
    return this.paymentService.update(id, updateQuotationPaymentDto);
  }
}
