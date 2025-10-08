import { Injectable, NotFoundException } from '@nestjs/common';

import { CreateStatusQuotationDto } from './dto/create-status.dto';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { UpdateStatusQuotationDto } from './dto/update-status.dto';
import { QuotationTag } from '@prisma/client';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';

@Injectable()
export class StatusService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    createStatusQuotationDto: CreateStatusQuotationDto,
  ): Promise<QuotationTag> {
    return this.prisma.quotationTag.create({
      data: createStatusQuotationDto,
    });
  }

  async findAll(filter: BaseFilterDTO): Promise<any> {
    const { page = 1, limit = 10, companyId } = filter;
    const skip = (+page - 1) * +limit;

    const [total, quotationTags] = await Promise.all([
      this.prisma.quotationTag.count({
        where: { isActive: true, companyId },
      }),
      this.prisma.quotationTag.findMany({
        where: { isActive: true, companyId },
        select: { id: true, title: true, color: true },
        orderBy: { title: 'asc' },
        skip,
        take: +limit,
      }),
    ]);

    return {
      total,
      page,
      limit,
      quotationTags,
    };
  }

  async findOne(id: string): Promise<QuotationTag> {
    const status = await this.prisma.quotationTag.findUnique({
      where: { id },
    });

    if (!status) {
      throw new NotFoundException(
        `Status de orçamento com ID ${id} não encontrado`,
      );
    }

    return status;
  }

  async update(
    id: string,
    updateStatusQuotationDto: UpdateStatusQuotationDto,
  ): Promise<QuotationTag> {
    const statusExists = await this.prisma.quotationTag.findUnique({
      where: { id },
    });

    if (!statusExists) {
      throw new NotFoundException(
        `Status de orçamento com ID ${id} não encontrado`,
      );
    }

    return this.prisma.quotationTag.update({
      where: { id },
      data: updateStatusQuotationDto,
    });
  }

  async remove(id: string): Promise<QuotationTag> {
    const statusExists = await this.prisma.quotationTag.findUnique({
      where: { id },
    });

    if (!statusExists) {
      throw new NotFoundException(
        `Status de orçamento com ID ${id} não encontrado`,
      );
    }

    await this.prisma.quotation.updateMany({
      where: {
        tagId: id,
      },
      data: {
        tagId: null,
      },
    });

    return this.prisma.quotationTag.update({
      where: { id },
      data: {
        isActive: false,
      },
    });
  }
}
