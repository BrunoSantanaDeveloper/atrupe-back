import { Injectable } from '@nestjs/common';
import { CreateReasonDto } from './dto/create-cancel-reason.dto';
import { UpdateReasonDto } from './dto/update-cancel-reason.dto';
import { PrismaService } from 'nestjs-prisma';
import { CancelReasonFilterDto } from './dto/cancel-reason-filters.dto';

@Injectable()
export class CancelReasonService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createReasonDto: CreateReasonDto) {
    return this.prisma.reasons.create({
      data: createReasonDto,
    });
  }

  async update(id: string, updateReasonDto: UpdateReasonDto) {
    return this.prisma.reasons.update({
      where: { id },
      data: updateReasonDto,
    });
  }

  async remove(id: string) {
    return this.prisma.reasons.delete({
      where: { id },
    });
  }

  async findAllByType(filter: CancelReasonFilterDto) {
    const { companyId, page, limit, type, search } = filter;

    const [total, reasons] = await Promise.all([
      this.prisma.reasons.count({
        where: {
          companyId,
          type,
          reason: search
            ? { contains: search, mode: 'insensitive' }
            : undefined,
        },
      }),
      this.prisma.reasons.findMany({
        where: {
          companyId,
          type,
          reason: search
            ? { contains: search, mode: 'insensitive' }
            : undefined,
        },
        skip: (+page - 1) * +limit,
        take: +limit,
        orderBy: { reason: 'asc' },
      }),
    ]);

    const lastPage = Math.ceil(total / +limit);

    const grouped = reasons.reduce(
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
    );

    const result = [
      { type: 'REJECTION', reasons: grouped['REJECTION'] || [] },
      { type: 'CANCELLATION', reasons: grouped['CANCELLATION'] || [] },
    ];

    return {
      total,
      lastPage,
      data: result,
    };
  }
}
