import { Injectable } from '@nestjs/common';
import { CreateReasonDto } from './dto/create-setting.dto';
import { UpdateReasonDto } from './dto/update-setting.dto';
import { PrismaService } from 'nestjs-prisma';

@Injectable()
export class SettingsService {
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

  async findAllByType(type: 'REJECTION' | 'CANCELLATION', companyId: string) {
    const [total, reasons] = await Promise.all([
      this.prisma.reasons.count({
        where: { type, companyId },
      }),
      this.prisma.reasons.findMany({
        where: { type, companyId },
      }),
    ]);

    return [
      {
        total,
        data: reasons,
      },
    ];
  }
}
