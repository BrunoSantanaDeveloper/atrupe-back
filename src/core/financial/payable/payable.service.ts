import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CreatePayableDto,
  UpdatePayableInstallmentsDto,
} from './dto/create-payable.dto';
import { PayInstallmentDto, UpdatePayableDto } from './dto/update-payable.dto';
import { PrismaService } from 'nestjs-prisma';
import { ReceivableFilterDto } from '../receivable/dto/receivable-filter.dto';

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

  async findAll(paginationDto: ReceivableFilterDto) {
    if (!paginationDto.companyId) {
      throw new BadRequestException('companyId is required');
    }

    const { page = 1, limit = 10, search, dueDate } = paginationDto;

    const filters: any = {
      receivable: {
        companyId: paginationDto.companyId,
      },
    };

    // Filtro de data baseado em dueDate
    if (dueDate) {
      filters.dueDate = {
        gt: new Date(dueDate),
      };
    }

    // Filtro de pesquisa para cliente, categoria ou subcategoria
    if (search) {
      filters.receivable.OR = [
        { client: { name: { contains: search, mode: 'insensitive' } } },
        { category: { name: { contains: search, mode: 'insensitive' } } },
        { subCategory: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    // 1. Agrupamento no banco de dados com somatório e paginação
    const grouped = await this.prisma.payableInstallment.groupBy({
      by: ['dueDate'],
      where: filters,
      orderBy: { dueDate: 'desc' },
      skip: (+page - 1) * +limit,
      take: +limit,
      _sum: {
        amount: true,
        additionalFee: true,
      },
      _count: true,
    });

    // // 2. Calcular o total e as últimas páginas
    // const totalGroups = await this.prisma.receivableInstallment.groupBy({
    //   by: ['dueDate'],
    //   where: filters,
    //   _count: true,
    // });
    const totalInstallments = await this.prisma.payableInstallment.count();

    const total = totalInstallments;
    const lastPage = Math.ceil(total / +limit);

    // 3. Buscar os detalhes das parcelas apenas para os grupos retornados
    const dueDates = grouped.map((g) => g.dueDate);

    const installments = await this.prisma.payableInstallment.findMany({
      where: {
        dueDate: { in: dueDates },
        ...filters,
      },
      orderBy: { dueDate: 'desc' },
      select: {
        id: true,
        status: true,
        amount: true,
        additionalFee: true,
        paidDate: true,
        dueDate: true,
        payable: {
          select: {
            id: true,
            totalAmount: true,
            description: true,
            notes: true,
            status: true,
            referenceDate: true,
            supplier: { select: { id: true, name: true } },
            category: { select: { id: true, name: true } },
            // supplier: { select: { id: true, name: true } },
            nature: { select: { id: true, name: true } },
            installments: {
              select: {
                id: true,
                status: true,
                paymentMethod: { select: { id: true, name: true } },
                amount: true,
                additionalFee: true,
                dueDate: true,
                paidDate: true,
              },
              orderBy: { dueDate: 'desc' },
            },
          },
        },
      },
    });

    const groupedByDate = grouped.map((group) => {
      const expectedRevenue =
        (group._sum.amount || 0) + (group._sum.additionalFee || 0);

      const payableList = installments
        .filter(
          (inst) => inst.dueDate.toISOString() === group.dueDate.toISOString(),
        )
        .map((inst) => {
          return {
            id: inst.payable?.id || null,
            totalValue: inst.payable?.totalAmount || 0,
            description: inst.payable?.description || '',
            client: inst.payable?.supplier
              ? {
                  id: inst.payable.supplier.id,
                  name: inst.payable.supplier.name,
                }
              : null,
            category: inst.payable?.category
              ? {
                  id: inst.payable.category.id,
                  name: inst.payable.category.name,
                }
              : null,
            nature: inst.payable?.nature
              ? {
                  id: inst.payable.nature.id,
                  name: inst.payable.nature.name,
                }
              : null,
            installmentsQuantity: inst.payable?.installments?.length || 0,
            period: inst.payable?.referenceDate || null,
            notes: inst.payable?.notes || '',
            status: inst.payable?.status || 'UNKNOWN',
            installments: (inst.payable?.installments || [])
              .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime()) // Ordenando as parcelas pela data de vencimento
              .map((installment) => ({
                id: installment.id || null,
                status: installment.status || 'UNKNOWN',
                paymentMethod: installment.paymentMethod?.name || 'N/A',
                value: installment.amount || 0,
                additionalFee: installment.additionalFee || 0,
                dueDate: installment.dueDate || null,
                paidValue: installment.amount || 0, // Ajuste baseado nos requisitos.
                paymentDate: installment.paidDate || null,
                current: installment.id === inst.id, // Definindo se a parcela é a atual
              })),
          };
        });

      return {
        date: group.dueDate || null,
        expectedRevenue,
        transactions: payableList,
      };
    });
    return {
      total,
      lastPage,
      data: groupedByDate,
    };
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
