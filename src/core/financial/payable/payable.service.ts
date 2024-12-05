import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CreatePayableDto,
  UpdatePayableInstallmentsDto,
} from './dto/create-payable.dto';
import { PayInstallmentDto, UpdatePayableDto } from './dto/update-payable.dto';
import { PrismaService } from 'nestjs-prisma';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';

@Injectable()
export class PayableService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreatePayableDto) {
    const { installments, ...payableData } = dto;

    if (installments.length === 0) {
      throw new Error('At least one installment is required.');
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const totalAmount = installments
          .reduce((sum, installment) => {
            const additionalFee = installment.additionalFee ?? 0;
            return sum + installment.amount + additionalFee;
          }, 0)
          .toFixed(2);

        const payable = await tx.payable.create({
          data: {
            ...payableData,
            referenceDate: new Date(payableData.referenceDate),
            totalAmount: parseFloat(totalAmount),
            installmentQty: installments.length,
          },
        });

        // Cria as parcelas vinculadas
        await tx.payableInstallment.createMany({
          data: installments.map((installment, index) => ({
            ...installment,
            installmentNumber: index + 1,
            dueDate: new Date(installment.dueDate),
            payableId: payable.id,
          })),
        });

        return payable;
      });
    } catch (error) {
      console.error(error);
      throw new Error('Error creating payable' + error.message);
    }
  }

  async findAll(paginationDto: BaseFilterDTO) {
    const { page = 1, limit = 10 } = paginationDto;
    const skip = (+page - 1) * +limit;

    return this.prisma.payable.findMany({
      skip,
      take: +limit,
      include: { installments: true },
    });
  }

  async findOne(id: string) {
    const payable = await this.prisma.payable.findUnique({
      where: { id },
      include: { installments: true },
    });
    if (!payable)
      throw new NotFoundException('Conta a receber não encontrada.');
    return payable;
  }

  async updateTitle(id: string, dto: UpdatePayableDto) {
    try {
      const updatedPayable = await this.prisma.payable.update({
        where: { id },
        data: dto,
      });

      return updatedPayable;
    } catch (error) {
      console.error('Error updating payable title:', error);
      throw new Error('Failed to update payable title.');
    }
  }

  async cancel(id: string, cancelReason: string) {
    const payable = await this.findOne(id);

    // Verifica se o título já está cancelado
    if (payable.status === 'CANCELED') {
      throw new Error('A conta a receber já foi cancelada.');
    }

    // Atualiza o status de todas as parcelas com status "PENDING" para "CANCELED"
    const updates = payable.installments
      .filter((installment) => installment.status === 'PENDING')
      .map((installment) =>
        this.prisma.payableInstallment.update({
          where: { id: installment.id },
          data: { status: 'CANCELED' },
        }),
      );

    // Realiza a transação
    await this.prisma.$transaction(updates);
    await this.prisma.payable.update({
      where: { id },
      data: {
        status: 'CANCELED',
        cancelReason,
      },
    });
    return { message: 'Conta a receber cancelada com sucesso.' };
  }

  async remove(id: string) {
    await this.prisma.payableInstallment.deleteMany({
      where: { payableId: id },
    });
    await this.prisma.payableHistory.deleteMany({
      where: { payableId: id },
    });
    return await this.prisma.payable.delete({ where: { id } });
  }

  async count() {
    return this.prisma.payable.count();
  }

  async payInstallment(payInstallmentDto: PayInstallmentDto) {
    const { installmentId, amount, paidDate } = payInstallmentDto;

    return await this.prisma.$transaction(async (tx) => {
      // Atualiza o status da parcela para "PAGO" e adiciona a data do pagamento
      const installment = await tx.payableInstallment.update({
        where: { id: installmentId },
        data: {
          status: 'PAID',
          paidDate: new Date(paidDate),
          amount, // Pode ser que precise ajustar se houver um pagamento parcial
        },
      });

      // Atualiza o valor total do título
      const updatedTotal = await tx.payableInstallment.aggregate({
        where: { payableId: installment.payableId },
        _sum: { amount: true },
      });

      await tx.payable.update({
        where: { id: installment.payableId },
        data: { totalAmount: updatedTotal._sum.amount },
      });

      return { message: 'Parcela paga com sucesso.' };
    });
  }

  async updateInstallments(
    payableId: string,
    dto: UpdatePayableInstallmentsDto,
  ): Promise<any> {
    const { installments } = dto;

    let totalAmount = 0;

    const updatedPayable = await this.prisma.$transaction(async (prisma) => {
      const updatedInstallments = [];
      for (const installmentDto of installments) {
        const { id, ...rest } = installmentDto;

        if (id) {
          const updateData: Record<string, any> = { ...rest };
          console.log('Parcela existe');
          if (updateData.dueDate) {
            updateData.dueDate = new Date(updateData.dueDate);
          }

          // Se a parcela existe, atualiza
          try {
            const updatedInstallment = await prisma.payableInstallment.update({
              where: { id: installmentDto.id },
              data: updateData,
            });
            updatedInstallments.push(updatedInstallment);
          } catch (error) {
            console.error('Error updating installment:', error);
          }
        } else {
          console.log('Parcela não existe');
          const newInstallment = await prisma.payableInstallment.create({
            data: {
              payableId,
              amount: installmentDto.amount,
              dueDate: new Date(installmentDto.dueDate),
              paymentMethodId: installmentDto.paymentMethodId,
              installmentNumber: installments.indexOf(installmentDto) + 1,
            },
          });
          updatedInstallments.push(newInstallment);
        }
        totalAmount += installmentDto.amount;
      }

      // Busca parcelas existentes no banco
      const existingInstallments = await prisma.payableInstallment.findMany({
        where: { payableId },
      });

      const installmentIdsToKeep = updatedInstallments.map((inst) => inst.id);

      // Filtra parcelas a serem deletadas
      const installmentsToDelete = existingInstallments.filter(
        (inst) => !installmentIdsToKeep.includes(inst.id),
      );

      // Deleta parcelas que não estão no array de entrada
      for (const installment of installmentsToDelete) {
        await prisma.payableInstallment.delete({
          where: { id: installment.id },
        });
      }

      // Rearranja os números das parcelas restantes
      const allInstallments = await prisma.payableInstallment.findMany({
        where: { payableId },
        orderBy: { installmentNumber: 'asc' }, // Ordena por data de vencimento para manter a sequência lógica
      });

      for (let i = 0; i < allInstallments.length; i++) {
        await prisma.payableInstallment.update({
          where: { id: allInstallments[i].id },
          data: { installmentNumber: i + 1 }, // Rearranja os números
        });
      }

      // Recalcula o totalAmount, incluindo taxas
      totalAmount = allInstallments.reduce(
        (sum, installment) =>
          sum + installment.amount + (installment.additionalFee || 0),
        0,
      );

      // Atualiza o totalAmount no título principal
      try {
        const updatedPayable = await prisma.payable.update({
          where: { id: payableId },
          data: { totalAmount },
        });
        return updatedPayable;
      } catch (error) {
        console.error(error.message);
      }
    });

    return updatedPayable;
  }
}
