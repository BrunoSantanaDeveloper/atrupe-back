import { HasPermission } from 'src/core/auth/abac/has-permission.decorator';
import { ObservePermissions } from 'src/core/auth/abac/observe-permissions.decorator';
import { HasAnyPermission } from 'src/core/auth/abac/has-any-permission.decorator';
import { PermissionsGuard } from 'src/core/auth/abac/permissions.guard';
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
import { assertBelongsToCompany } from 'src/shared/tenant/company-scope';

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
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
// Permissão no endpoint em modo observar (Fase 2): a recusa vai para o log
// sem recusar, até a semana de log limpo; handler com
// @ObservePermissions(false) já recusa.
@ObservePermissions()
@Controller(`sale/${RESOURCE}`)
export class PaymentController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly prisma: PrismaService,
    private readonly abacService: AbacService,
  ) {}

  private async validateOwnership(
    quotationId: string,
    user: any,
    action: 'view' | 'edit' = 'edit',
  ) {
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
      await this.abacService.canAccessOtherSellers(user, action);

    if (
      !canAccessOtherQuotations &&
      !user.isAdmin &&
      user.employeeId &&
      quotation.sellerId !== user.employeeId
    ) {
      throw new ForbiddenException(
        action === 'view'
          ? 'Você não tem permissão para ver pagamentos de orçamentos de outros vendedores'
          : 'Você não tem permissão para editar pagamentos de orçamentos de outros vendedores',
      );
    }
  }

  /**
   * A condição de pagamento e o fornecedor da comissão vêm no corpo: precisam
   * ser da empresa do orçamento (a da sessão, já conferida)
   */
  private async assertRefsOfCompany(
    companyId: string,
    refs: { paymentConditionIds?: (string | undefined)[]; supplierId?: string },
  ) {
    await assertBelongsToCompany(
      this.prisma.paymentCondition,
      refs.paymentConditionIds,
      { companyId },
      'Condição de pagamento não encontrada.',
    );
    await assertBelongsToCompany(
      this.prisma.supplier,
      refs.supplierId,
      { companyId },
      'Fornecedor não encontrado.',
    );
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
  @HasPermission('view', 'sale:quotation')
  @ApiOperation({
    summary: 'Buscar informações de pagamento de um orçamento pelo ID',
  })
  @ApiParam({ name: 'id', description: 'ID do registro de pagamento' })
  async findOne(@Req() req, @Param('id') id: string) {
    // O id é o do orçamento: a leitura não conferia nada (valores, desconto,
    // parcelas e comissão de outra empresa)
    await this.validateOwnership(id, req.user, 'view');
    return this.paymentService.findOne(id);
  }

  @Patch(':quotationId')
  @HasAnyPermission(
    { action: 'edit', resource: 'sale:quotation' },
    { action: 'create', resource: 'sale:order' },
  )
  @ApiOperation({
    summary: 'Atualizar o pagamento da cota com base no ID da cota',
  })
  async updatePayment(
    @Param('quotationId') quotationId: string,
    @Body() updatePaymentDto: UpdatePaymentDto,
    @Req() req,
  ) {
    await this.validateOwnership(quotationId, req.user);
    await this.assertRefsOfCompany(req.user.companyId, {
      paymentConditionIds: [
        updatePaymentDto.paymentConditionId,
        updatePaymentDto.downPayment?.paymentConditionId,
        ...(updatePaymentDto.installments ?? []).map(
          (installment) => installment.paymentConditionId,
        ),
      ],
      supplierId: updatePaymentDto.commission?.supplier?.value,
    });
    const updatedPayment = await this.paymentService.updatePayment(
      quotationId,
      updatePaymentDto,
    );
    return updatedPayment;
  }

  @Patch('commission/:quotationId')
  @HasPermission('edit', 'sales_settings:seller_profile')
  // Sem uso no front e destrutiva: já recusa, sem passar pelo modo observar
  @ObservePermissions(false)
  async updateCommission(
    @Param('quotationId') quotationId: string,
    @Body() updateCommissionDto: UpdateCommissionDto,
    @Req() req,
  ) {
    await this.validateOwnership(quotationId, req.user);
    await this.assertRefsOfCompany(req.user.companyId, {
      supplierId: updateCommissionDto.supplier?.value,
    });
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
