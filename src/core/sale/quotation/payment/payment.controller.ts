import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PaymentService } from './payment.service';

import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import {
  UpdateCommissionDto,
  UpdatePaymentDto,
} from './dto/create-payment.dto';

const RESOURCE = 'payment';
const GROUP = 'quotation';

@ApiTags('Informações de pagamento do orçamento')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller(`${GROUP}/${RESOURCE}`)
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Get('condition/in-use')
  @ApiOperation({
    summary:
      'Obtém a lista de condições de pagamento que estão sendo utilizadas em lançamentos financeiros',
  })
  @ApiResponse({
    status: 200,
    description:
      'Lista de condições de pagamento em uso retornada com sucesso.',
  })
  async getPaymentConditionsInUse(@Req() req) {
    return this.paymentService.getPaymentConditionsInUse(req.user.companyId);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Buscar informações de pagamento de um orçamento pelo ID',
  })
  @ApiParam({ name: 'id', description: 'ID do registro de pagamento' })
  async findOne(@Param('id') id: string) {
    return this.paymentService.findOne(id);
  }

  @Patch(':quotationId')
  @ApiOperation({
    summary: 'Atualizar o pagamento da cota com base no ID da cota',
  })
  async updatePayment(
    @Param('quotationId') quotationId: string,
    @Body() updatePaymentDto: UpdatePaymentDto,
  ) {
    const updatedPayment = await this.paymentService.updatePayment(
      quotationId,
      updatePaymentDto,
    );
    return updatedPayment;
  }

  @Patch('commission/:quotationId')
  async updateCommission(
    @Param('quotationId') quotationId: string,
    @Body() updateCommissionDto: UpdateCommissionDto,
  ) {
    await this.paymentService.updateCommission(
      quotationId,
      updateCommissionDto,
    );
    return {
      message: 'Commission updated successfully',
      data: updateCommissionDto,
    };
  }
}
