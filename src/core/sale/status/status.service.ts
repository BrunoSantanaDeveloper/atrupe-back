import { Injectable, NotFoundException } from '@nestjs/common';

import { CreateStatusQuotationDto } from './dto/create-status.dto';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { UpdateStatusQuotationDto } from './dto/update-status.dto';
import { StatusQuotation } from '@prisma/client';

@Injectable()
export class StatusService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    createStatusQuotationDto: CreateStatusQuotationDto,
  ): Promise<StatusQuotation> {
    return this.prisma.statusQuotation.create({
      data: createStatusQuotationDto,
    });
  }

  async findAll(
    companyId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<any> {
    const skip = (page - 1) * limit;

    const [total, statusQuotations] = await Promise.all([
      this.prisma.statusQuotation.count({
        where: { isActive: true, companyId },
      }),
      this.prisma.statusQuotation.findMany({
        where: { isActive: true, companyId },
        select: { id: true, title: true, color: true },
        orderBy: { title: 'asc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      total,
      page,
      limit,
      statusQuotations,
    };
  }

  async findOne(id: string): Promise<StatusQuotation> {
    const status = await this.prisma.statusQuotation.findUnique({
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
  ): Promise<StatusQuotation> {
    const statusExists = await this.prisma.statusQuotation.findUnique({
      where: { id },
    });

    if (!statusExists) {
      throw new NotFoundException(
        `Status de orçamento com ID ${id} não encontrado`,
      );
    }

    return this.prisma.statusQuotation.update({
      where: { id },
      data: updateStatusQuotationDto,
    });
  }

  async remove(id: string): Promise<StatusQuotation> {
    const statusExists = await this.prisma.statusQuotation.findUnique({
      where: { id },
    });

    if (!statusExists) {
      throw new NotFoundException(
        `Status de orçamento com ID ${id} não encontrado`,
      );
    }

    return this.prisma.statusQuotation.delete({
      where: { id },
    });
  }
}
