import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import {
  CreateReceivableDto,
  UpdateReceivableInstallmentsDto,
} from './dto/create-receivable.dto';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';
import {
  PayInstallmentDto,
  UpdateReceivableDto,
} from './dto/update-receivable.dto';

@Injectable()
export class ReceivableService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateReceivableDto) {
    const { installments, ...receivableData } = dto;

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

        const receivable = await tx.receivable.create({
          data: {
            ...receivableData,
            dueDate: new Date(receivableData.dueDate),
            referenceDate: new Date(receivableData.referenceDate),
            totalAmount: parseFloat(totalAmount),
            installmentQty: installments.length,
          },
        });

        // Cria as parcelas vinculadas
        await tx.receivableInstallment.createMany({
          data: installments.map((installment, index) => ({
            ...installment,
            installmentNumber: index + 1,
            dueDate: new Date(installment.dueDate),
            receivableId: receivable.id,
          })),
        });

        return receivable;
      });
    } catch (error) {
      console.error(error);
      throw new Error('Error creating receivable' + error.message);
    }
  }

  async findAll(paginationDto: BaseFilterDTO) {
    const { page = 1, limit = 10 } = paginationDto;
    const skip = (+page - 1) * +limit;

    return this.prisma.receivable.findMany({
      skip,
      take: +limit,
      include: { installments: true },
    });
  }

  async findOne(id: string) {
    const receivable = await this.prisma.receivable.findUnique({
      where: { id },
      include: { installments: true },
    });
    if (!receivable)
      throw new NotFoundException('Conta a receber não encontrada.');
    return receivable;
  }

  async updateTitle(id: string, dto: UpdateReceivableDto) {
    try {
      const updatedReceivable = await this.prisma.receivable.update({
        where: { id },
        data: dto,
      });

      return updatedReceivable;
    } catch (error) {
      console.error('Error updating receivable title:', error);
      throw new Error('Failed to update receivable title.');
    }
  }

  async cancel(id: string, cancelReason: string) {
    const receivable = await this.findOne(id);

    // Verifica se o título já está cancelado
    if (receivable.status === 'CANCELED') {
      throw new Error('A conta a receber já foi cancelada.');
    }

    // Atualiza o status de todas as parcelas com status "PENDING" para "CANCELED"
    const updates = receivable.installments
      .filter((installment) => installment.status === 'PENDING')
      .map((installment) =>
        this.prisma.receivableInstallment.update({
          where: { id: installment.id },
          data: { status: 'CANCELED' },
        }),
      );

    // Realiza a transação
    await this.prisma.$transaction(updates);
    await this.prisma.receivable.update({
      where: { id },
      data: {
        status: 'CANCELED',
        cancelReason,
      },
    });
    return { message: 'Conta a receber cancelada com sucesso.' };
  }

  async remove(id: string) {
    await this.prisma.receivableInstallment.deleteMany({
      where: { receivableId: id },
    });
    await this.prisma.receivableHistory.deleteMany({
      where: { receivableId: id },
    });
    return await this.prisma.receivable.delete({ where: { id } });
  }

  async count() {
    return this.prisma.receivable.count();
  }

  async payInstallment(payInstallmentDto: PayInstallmentDto) {
    const { installmentId, amount, paidDate } = payInstallmentDto;

    return await this.prisma.$transaction(async (tx) => {
      // Atualiza o status da parcela para "PAGO" e adiciona a data do pagamento
      const installment = await tx.receivableInstallment.update({
        where: { id: installmentId },
        data: {
          status: 'PAID',
          paidDate: new Date(paidDate),
          amount, // Pode ser que precise ajustar se houver um pagamento parcial
        },
      });

      // Atualiza o valor total do título
      const updatedTotal = await tx.receivableInstallment.aggregate({
        where: { receivableId: installment.receivableId },
        _sum: { amount: true },
      });

      await tx.receivable.update({
        where: { id: installment.receivableId },
        data: { totalAmount: updatedTotal._sum.amount },
      });

      return { message: 'Parcela paga com sucesso.' };
    });
  }

  async updateInstallments(
    receivableId: string,
    dto: UpdateReceivableInstallmentsDto,
  ): Promise<any> {
    const { installments } = dto;

    let totalAmount = 0;

    const updatedReceivable = await this.prisma.$transaction(async (prisma) => {
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
            const updatedInstallment =
              await prisma.receivableInstallment.update({
                where: { id: installmentDto.id },
                data: updateData,
              });
            updatedInstallments.push(updatedInstallment);
          } catch (error) {
            console.error('Error updating installment:', error);
          }
        } else {
          console.log('Parcela não existe');
          const newInstallment = await prisma.receivableInstallment.create({
            data: {
              receivableId,
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
      const existingInstallments = await prisma.receivableInstallment.findMany({
        where: { receivableId },
      });

      const installmentIdsToKeep = updatedInstallments.map((inst) => inst.id);

      // Filtra parcelas a serem deletadas
      const installmentsToDelete = existingInstallments.filter(
        (inst) => !installmentIdsToKeep.includes(inst.id),
      );

      // Deleta parcelas que não estão no array de entrada
      for (const installment of installmentsToDelete) {
        await prisma.receivableInstallment.delete({
          where: { id: installment.id },
        });
      }

      // Rearranja os números das parcelas restantes
      const allInstallments = await prisma.receivableInstallment.findMany({
        where: { receivableId },
        orderBy: { installmentNumber: 'asc' }, // Ordena por data de vencimento para manter a sequência lógica
      });

      for (let i = 0; i < allInstallments.length; i++) {
        await prisma.receivableInstallment.update({
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
        const updatedReceivable = await prisma.receivable.update({
          where: { id: receivableId },
          data: { totalAmount },
        });
        return updatedReceivable;
      } catch (error) {
        console.error(error.message);
      }
    });

    return updatedReceivable;
  }
}
