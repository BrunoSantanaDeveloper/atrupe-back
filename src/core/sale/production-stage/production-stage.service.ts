import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { UpdateProductionStageDto } from './dto/update-production-stage.dto';
import { PrismaService } from 'src/config/prisma/prisma.service';

@Injectable()
export class ProductionStageService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.productionStage.findMany();
  }

  findOne(id: string) {
    return this.prisma.productionStage.findUnique({ where: { id } });
  }

  async update(id: string, updateProductionStageDto: UpdateProductionStageDto) {
    const productionStage = await this.prisma.productionStage.findUnique({
      where: { id },
    });

    if (!productionStage) {
      throw new NotFoundException('Etapa de produção nao encontrada');
    }

    updateProductionStageDto.prevStatus = productionStage.status;

    try {
      await this.prisma.productionStage.update({
        where: { id },
        data: updateProductionStageDto,
      });

      await this.updateStatusIfAllStagesAreDone(productionStage.scheduleId);
    } catch (error) {
      console.error(error);
      throw new BadRequestException('Error on update production stage');
    }
  }

  async updateStatusIfAllStagesAreDone(scheduleId: string) {
    // Buscar o status atual da entrega
    const deliverySchedule = await this.prisma.deliverySchedule.findUnique({
      where: { id: scheduleId },
      select: { status: true },
    });

    // Se o status já for FINALIZADO, não faz nada
    if (
      !deliverySchedule ||
      ['FINISHED', 'DONE'].includes(deliverySchedule.status)
    ) {
      return;
    }

    // Buscar todas as etapas de produção dessa agenda
    const allStages = await this.prisma.productionStage.findMany({
      where: { scheduleId },
      select: {
        id: true,
        status: true,
        stage: {
          select: {
            id: true,
            name: true,
            icon: true,
          },
        },
      },
    });

    // Separar a etapa de entrega
    const productionStages = allStages.filter(
      (stage) => !['Entrega', 'Cliente Retira'].includes(stage.stage.name),
    );

    // Verificar se todas as etapas estão "DONE" ou "CANCELED"
    const allDoneOrCanceled = productionStages.every((stage) =>
      ['DONE', 'CANCELED'].includes(stage.status),
    );

    // Definir o novo status da entrega
    const newStatus = allDoneOrCanceled ? 'DELIVERING' : 'IN_PRODUCTION';

    // Atualizar o status da agenda de entrega
    await this.prisma.deliverySchedule.update({
      where: { id: scheduleId },
      data: { status: newStatus },
    });
  }

  remove(id: string) {
    return this.prisma.productionStage.delete({ where: { id } });
  }
}
