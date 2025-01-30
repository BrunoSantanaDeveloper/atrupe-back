/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/config/prisma/prisma.service';
import {
  UpdateCommissionDto,
  UpdatePaymentDto,
} from './dto/create-payment.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class PaymentService {
  constructor(private readonly prisma: PrismaService) {}
  async findOne(id: string) {
    return this.prisma.quotationPayment.findUnique({
      where: { quotationId: id },
      include: {
        paymentMethod: true,
        paymentCondition: true,
        commission: true,
        quotationInstallment: true,
      },
    });
  }
  async updatePayment(quotationId: string, updateData: UpdatePaymentDto) {
    const existingPayment = await this.findOne(quotationId);
    if (!existingPayment) {
      throw new NotFoundException('Pagamento não encontrado');
    }

    try {
      const {
        installments,
        commission,
        downPayment,
        paymentConditionId,
        paymentMethodId,
        ...rest
      } = updateData;
      if (downPayment) {
        Object.assign(rest, {
          downPayment: downPayment.amount || 0,
          downPaymentCondition: {
            connect: { id: downPayment.paymentConditionId },
          },
          downPaymentDueDate: new Date(downPayment.dueDate),
          downPaymentSurcharge: downPayment.additionalFee || 0,
        });
      }

      if (paymentMethodId) {
        rest['paymentMethod'] = {
          connect: { id: paymentMethodId },
        };
      }
      if (rest) {
        rest['paymentCondition'] = {
          connect: { id: paymentConditionId },
        };
      }

      // Inicia uma transação para manter atomicidade
      const updatedPaymentData = await this.prisma.$transaction(
        async (prisma) => {
          // Atualiza o pagamento principal
          const updatedPayment = await prisma.quotationPayment.update({
            where: { quotationId },
            data: rest,
          });

          const conditionConfig = await prisma.paymentCondition.findUnique({
            where: {
              id: paymentConditionId,
            },
          });
          // Busca a configuração das parcelas
          const installmentsConfig = await prisma.installment.findMany({
            where: {
              paymentConditionId: paymentConditionId,
            },
          });

          for (const [index, installmentDto] of installments.entries()) {
            const { id, ...rest } = installmentDto;

            const additionalFee =
              conditionConfig.costType === 'FIXED'
                ? installmentsConfig[index]?.operatorFeeTransfer || 0
                : (installmentsConfig[index]?.operatorFeeTransfer / 100) *
                  installmentDto.amount;
            const amount = installmentDto.amount || 0;

            if (id) {
              // Parcela existente, atualiza
              await prisma.quotationInstallment.update({
                where: { id },
                data: {
                  quotationPaymentId: updatedPayment.id,
                  dueDate: new Date(installmentDto.dueDate),
                  surcharge: additionalFee,
                  value: amount,
                  paymentMethodId: rest.paymentMethodId,
                },
              });
            } else {
              // Nova parcela, cria
              await prisma.quotationInstallment.create({
                data: {
                  quotationPaymentId: updatedPayment.id,
                  dueDate: new Date(installmentDto.dueDate),
                  surcharge: additionalFee,
                  value: amount,
                  paymentMethodId: rest.paymentMethodId,
                },
              });
            }
          }

          if (commission) {
            await this.updateCommission(quotationId, commission);
          }
          return updatedPayment;
        },
        { timeout: 10000 },
      );

      return updatedPaymentData;
    } catch (error) {
      console.error(error);
      throw new Error('Error updating payment: ' + error.message);
    }
  }
  async updateCommission(
    quotationId: string,
    commissionData: UpdateCommissionDto,
  ) {
    try {
      // Busca o pagamento relacionado à cotação
      const quotationPayment = await this.prisma.quotationPayment.findUnique({
        where: { quotationId },
        include: { commission: true }, // Inclui a comissão associada, se houver
      });

      if (!quotationPayment) {
        throw new Error('Quotation payment not found.');
      }

      const commissionPayload: Prisma.CommissionCreateInput = {
        type: commissionData.type,
        supplier: { connect: { id: commissionData.supplierId } },
        transferMethod: commissionData.transferMethod,
        commissionType: commissionData.commissionType,
        commissionValue: commissionData.commissionValue,
        quotationPayment: { connect: { id: quotationPayment.id } },
      };

      let updatedCommission;

      if (quotationPayment.commission) {
        // Atualiza a comissão existente
        updatedCommission = await this.prisma.commission.update({
          where: { id: quotationPayment.commission.id },
          data: commissionPayload,
        });
      } else {
        // Cria uma nova comissão
        updatedCommission = await this.prisma.commission.create({
          data: commissionPayload,
        });
      }

      // await this.prisma.quotation.update({
      //   where: {
      //     id: quotationId,
      //   },
      // });

      return updatedCommission;
    } catch (error) {
      console.error(error);
      throw new BadRequestException(
        'Error updating commission: ' + error.message,
      );
    }
  }
}
