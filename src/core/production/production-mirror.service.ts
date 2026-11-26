import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { ProductionStageStatus } from '@prisma/client';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { ProductionStageService } from '../sale/production-stage/production-stage.service';

/** As etapas de sistema da agenda (a saída), que não são produção. */
const SYSTEM_STAGES = ['Entrega', 'Cliente Retira'];

type Status = ProductionStageStatus;

/**
 * A situação de um conjunto de tarefas, para a etapa da agenda: tudo
 * encerrado é concluída (ou cancelada, se nada foi feito); o que está em
 * andamento, pendente ou pausado aparece nessa ordem; começada em parte
 * conta como em andamento.
 */
export const aggregateStatus = (statuses: Status[]): Status => {
  if (!statuses.length) return 'NOT_STARTED';
  const closed = (status: Status) => status === 'DONE' || status === 'CANCELED';
  if (statuses.every(closed)) {
    return statuses.every((status) => status === 'CANCELED')
      ? 'CANCELED'
      : 'DONE';
  }
  if (statuses.includes('IN_PROGRESS')) return 'IN_PROGRESS';
  if (statuses.includes('PENDING')) return 'PENDING';
  if (statuses.includes('PAUSED')) return 'PAUSED';
  if (statuses.some(closed)) return 'IN_PROGRESS';
  return 'NOT_STARTED';
};

/**
 * A Agenda de entrega no ELITE (D20, PO 14/10/2026): as etapas de produção
 * continuam lá, com a situação espelhada das tarefas do gerenciador, sem
 * edição. Cada etapa da agenda (um setor) segue as tarefas daquele setor da
 * composição; o setor sem tarefa segue o projeto inteiro.
 */
@Injectable()
export class ProductionMirrorService {
  constructor(
    private readonly prisma: PrismaService,
    // forwardRef: os arquivos se importam em ciclo (production-stage →
    // quotation-items → quotation-lines → production-project → este →
    // production-stage). Sem ele, a classe chega undefined e a API não sobe
    // (26/11/2026; o mesmo caso do OrderRedoService em 24/11)
    @Inject(forwardRef(() => ProductionStageService))
    private readonly stages: ProductionStageService,
  ) {}

  async sync(projectId: string) {
    const project = await this.prisma.productionProject.findUnique({
      where: { id: projectId },
      select: {
        quotationId: true,
        tasks: { select: { sectorId: true, status: true } },
      },
    });
    if (!project) return;
    const schedule = await this.prisma.deliverySchedule.findFirst({
      where: {
        OR: [
          { quotationId: project.quotationId },
          { deliveryInfo: { quotationId: project.quotationId } },
        ],
      },
      select: {
        id: true,
        productionStages: {
          select: {
            id: true,
            stageId: true,
            status: true,
            stage: { select: { name: true } },
          },
        },
      },
    });
    if (!schedule) return;
    const all = project.tasks.map((task) => task.status as Status);
    const updates = schedule.productionStages
      .filter((stage) => !SYSTEM_STAGES.includes(stage.stage?.name ?? ''))
      .map((stage) => {
        const own = project.tasks
          .filter((task) => task.sectorId && task.sectorId === stage.stageId)
          .map((task) => task.status as Status);
        return { stage, status: aggregateStatus(own.length ? own : all) };
      })
      .filter(({ stage, status }) => stage.status !== status);
    if (updates.length) {
      await this.prisma.$transaction(
        updates.map(({ stage, status }) =>
          this.prisma.productionStage.update({
            where: { id: stage.id },
            data: { status, prevStatus: stage.status },
          }),
        ),
      );
    }
    await this.stages.updateStatusIfAllStagesAreDone(schedule.id);
  }
}
