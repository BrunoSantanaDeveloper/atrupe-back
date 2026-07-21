import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { AbacService } from 'src/core/auth/abac/abac.service';
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

const RESOURCE = 'quotation/payment';

@ApiTags('Informações de pagamento do orçamento')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller(`sale/${RESOURCE}`)
export class PaymentController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly prisma: PrismaService,
    private readonly abacService: AbacService,
  ) {}

  private async validateOwnership(quotationId: string, user: any) {
    const quotation = await this.prisma.quotation.findUnique({
      where: { id: quotationId },
    });
    if (!quotation) {
      throw new NotFoundException('Orçamento não encontrado');
    }
    if (quotation.companyId !== user.companyId) {
      throw new ForbiddenException('Orçamento pertence a outra empresa');
    }

    const canAccessOtherQuotations =
      await this.abacService.canAccessOtherSellers(user, 'edit');

    if (
      !canAccessOtherQuotations &&
      !user.isAdmin &&
      user.employeeId &&
      quotation.sellerId !== user.employeeId
    ) {
      throw new ForbiddenException(
        'Você não tem permissão para editar pagamentos de orçamentos de outros vendedores',
      );
    }
  }

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
    @Req() req,
  ) {
    await this.validateOwnership(quotationId, req.user);
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
    @Req() req,
  ) {
    await this.validateOwnership(quotationId, req.user);
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
