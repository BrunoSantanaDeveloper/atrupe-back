import { Injectable } from '@nestjs/common';
import { CreateReasonDto } from './dto/create-cancel-reason.dto';
import { UpdateReasonDto } from './dto/update-cancel-reason.dto';
import { PrismaService } from 'nestjs-prisma';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';

@Injectable()
export class CancelReasonService {
  constructor(private readonly prisma: PrismaService) {}

  // Criar motivo
  async create(createReasonDto: CreateReasonDto) {
    return this.prisma.reasons.create({
      data: createReasonDto,
    });
  }

  // Atualizar motivo
  async update(id: string, updateReasonDto: UpdateReasonDto) {
    return this.prisma.reasons.update({
      where: { id },
      data: updateReasonDto,
    });
  }

  // Remover motivo
  async remove(id: string) {
    return this.prisma.reasons.delete({
      where: { id },
    });
  }

  async findAllByType(filter: BaseFilterDTO) {
    const { companyId, page, limit } = filter;

    // Buscar o total de razões e as razões paginadas
    const [total, reasons] = await Promise.all([
      this.prisma.reasons.count({
        where: { companyId },
      }),
      this.prisma.reasons.findMany({
        where: { companyId },
        skip: (+page - 1) * +limit,
        take: +limit,
        orderBy: { reason: 'asc' },
      }),
    ]);

    // Calcular a última página
    const lastPage = Math.ceil(total / +limit);

    // Agrupar as razões pelo `type` e formatar os dados conforme desejado
    const grouped = Object.entries(
      reasons.reduce(
        (acc, reason) => {
          if (!acc[reason.type]) {
            acc[reason.type] = [];
          }
          acc[reason.type].push({
            id: reason.id,
            reason: reason.reason,
          });
          return acc;
        },
        {} as Record<string, any[]>,
      ),
    ).map(([type, reasons]) => ({
      type,
      reasons,
    }));

    // Retornar os dados no formato desejado
    return {
      total,
      lastPage,
      data: grouped,
    };
  }
}
