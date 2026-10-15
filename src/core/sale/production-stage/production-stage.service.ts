import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '@prisma/client';
import { UpdateProductionStageDto } from './dto/update-production-stage.dto';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { assertBelongsToCompany } from 'src/shared/tenant/company-scope';

const STAGE_NOT_FOUND = 'Etapa de produção nao encontrada';
const MANAGED_BY_PRODUCTION =
  'As etapas desta venda seguem o gerenciador de produção';

/**
 * A agenda de entrega da empresa: a companyId da agenda é opcional, então
 * vale também a empresa do orçamento ou do pedido dela.
 */
function scheduleOfCompany(
  companyId: string,
): Prisma.DeliveryScheduleWhereInput {
  return {
    OR: [
      { companyId },
      { quotation: { companyId } },
      { order: { quotation: { companyId } } },
    ],
  };
}

@Injectable()
export class ProductionStageService {
  constructor(private readonly prisma: PrismaService) {}

  // Toda leitura e escrita fica nas agendas da empresa da sessão: a lista
  // trazia as etapas de todas as empresas, e o id de outra empresa alterava
  // ou apagava a etapa dela e recalculava a agenda dela
  findAll(companyId: string) {
    return this.prisma.productionStage.findMany({
      where: { schedule: scheduleOfCompany(companyId) },
    });
  }

  async findOne(id: string, companyId: string) {
    const productionStage = await this.prisma.productionStage.findFirst({
      where: { id, schedule: scheduleOfCompany(companyId) },
    });
    if (!productionStage) {
      throw new NotFoundException(STAGE_NOT_FOUND);
    }
    return productionStage;
  }

  async update(
    id: string,
    updateProductionStageDto: UpdateProductionStageDto,
    companyId: string,
  ) {
    const productionStage = await this.findOne(id, companyId);
    await this.assertNotManaged(productionStage.scheduleId);
    // O setor da etapa (stageId) precisa ser da empresa: antes, o de outra
    // empresa era gravado e aparecia, com nome e ícone, na agenda
    await assertBelongsToCompany(
      this.prisma.companySector,
      updateProductionStageDto.stageId,
      { companyId },
      'Setor não encontrado.',
    );

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
            color: true,
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

  /** Recalcula a agenda pela rota: só a agenda da empresa da sessão */
  async updateScheduleOfCompany(scheduleId: string, companyId: string) {
    const schedule = await this.prisma.deliverySchedule.findFirst({
      where: { id: scheduleId, ...scheduleOfCompany(companyId) },
      select: { id: true },
    });
    if (!schedule) {
      throw new NotFoundException('Agenda de entrega não encontrada.');
    }
    return this.updateStatusIfAllStagesAreDone(scheduleId);
  }

  /**
   * No ELITE, a venda com projeto de produção tem as etapas espelhadas das
   * tarefas do gerenciador, sem edição na agenda (D20, PO 14/10/2026).
   */
  private async assertNotManaged(scheduleId: string) {
    const managed = await this.prisma.productionProject.count({
      where: {
        quotation: {
          OR: [
            { DeliverySchedule: { is: { id: scheduleId } } },
            {
              deliveryInfo: {
                is: { deliverySchedule: { is: { id: scheduleId } } },
              },
            },
          ],
        },
      },
    });
    if (managed) throw new ConflictException(MANAGED_BY_PRODUCTION);
  }

  async remove(id: string, companyId: string) {
    const stage = await this.findOne(id, companyId);
    await this.assertNotManaged(stage.scheduleId);
    return this.prisma.productionStage.delete({ where: { id } });
  }
}
