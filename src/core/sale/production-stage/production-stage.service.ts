import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { DeliveryScheduleStatus, Prisma } from '@prisma/client';
import { UpdateProductionStageDto } from './dto/update-production-stage.dto';
import { UpdateItemStageDto } from './dto/item-stage.dto';
import {
  ItemStage,
  OPEN,
  StageStatus,
  itemChanges,
  orderStatusAfter,
} from './stage-aggregate';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { assertBelongsToCompany } from 'src/shared/tenant/company-scope';

const STAGE_NOT_FOUND = 'Etapa de produção nao encontrada';
const MANAGED_BY_PRODUCTION =
  'As etapas desta venda seguem o gerenciador de produção';
const ITEM_STAGE_NOT_FOUND = 'Etapa do item não encontrada';
// Entrega e Cliente Retira não são etapas de produção
const DELIVERY_STAGES = ['Entrega', 'Cliente Retira'];
/** A agenda fechada: entregue (FINISHED, DONE) ou cancelada */
const CLOSED_SCHEDULE: DeliveryScheduleStatus[] = [
  'CANCELED',
  'FINISHED',
  'DONE',
];

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

    // O anterior só muda quando o estado muda: gravar o mesmo estado (só a
    // nota, ou o setor) não perde para onde voltar
    const from = productionStage.status as StageStatus;
    const next = updateProductionStageDto.status as StageStatus | undefined;
    updateProductionStageDto.prevStatus =
      next && next !== from ? from : productionStage.prevStatus;

    try {
      await this.prisma.productionStage.update({
        where: { id },
        data: updateProductionStageDto,
      });

      // Com etapas por item (§4.7), a ação no pedido vale para os itens
      // abertos daquele setor, e o pedido volta a ser o resumo deles
      const stageId =
        updateProductionStageDto.stageId ?? productionStage.stageId;
      if (next && stageId) {
        await this.applyToItems(
          productionStage.scheduleId,
          stageId,
          from,
          next,
          updateProductionStageDto.notes,
        );
      }

      await this.updateStatusIfAllStagesAreDone(productionStage.scheduleId);
    } catch (error) {
      console.error(error);
      throw new BadRequestException('Error on update production stage');
    }
  }

  /**
   * A troca de estado na etapa de um item (área 9 §4.7; Maicol, 23/11/2026).
   * Vale só para aquele item; a etapa do pedido no mesmo setor é recalculada.
   */
  async updateItem(id: string, dto: UpdateItemStageDto, companyId: string) {
    const item = await this.prisma.productionItemStage.findFirst({
      where: { id, schedule: scheduleOfCompany(companyId) },
    });
    if (!item) throw new NotFoundException(ITEM_STAGE_NOT_FOUND);
    await this.assertNotManaged(item.scheduleId);
    await this.prisma.productionItemStage.update({
      where: { id },
      data: {
        status: dto.status,
        // Gravar o mesmo estado (só a nota) não perde para onde voltar
        prevStatus: dto.status === item.status ? item.prevStatus : item.status,
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
    });
    await this.syncOrderStage(item.scheduleId, item.stageId);
    await this.updateStatusIfAllStagesAreDone(item.scheduleId);
    return { ok: true };
  }

  /**
   * Aplica a ação do pedido aos itens do setor e recalcula o pedido. Cada
   * item recebe a troca que lhe cabe (itemChanges): tirar a pendência devolve
   * a cada item o próprio estado anterior, e voltar o pedido fechado reabre
   * os itens da etapa, em vez de o resumo desfazer a volta em silêncio.
   */
  private async applyToItems(
    scheduleId: string,
    stageId: string,
    from: StageStatus,
    next: StageStatus,
    notes?: string,
  ) {
    const items = await this.prisma.productionItemStage.findMany({
      where: { scheduleId, stageId },
      select: { id: true, status: true, prevStatus: true },
    });
    if (!items.length) return;
    for (const item of itemChanges(items as ItemStage[], from, next)) {
      await this.prisma.productionItemStage.update({
        where: { id: item.id },
        data: {
          status: item.status,
          prevStatus: item.prevStatus,
          ...(notes !== undefined ? { notes } : {}),
        },
      });
    }
    await this.syncOrderStage(scheduleId, stageId, next);
  }

  /**
   * A etapa do pedido no setor = o resumo das etapas dos itens (§4.7). Com
   * a ação feita no pedido, cancelar fica cancelado (orderStatusAfter).
   */
  private async syncOrderStage(
    scheduleId: string,
    stageId: string,
    action?: StageStatus,
  ) {
    const items = await this.prisma.productionItemStage.findMany({
      where: { scheduleId, stageId },
      select: { status: true },
    });
    if (!items.length) return;
    const status = orderStatusAfter(
      items.map((item) => item.status as StageStatus),
      action,
    );
    const order = await this.prisma.productionStage.findFirst({
      where: { scheduleId, stageId },
      select: { id: true, status: true },
    });
    if (!order || order.status === status) return;
    await this.prisma.productionStage.update({
      where: { id: order.id },
      data: { status, prevStatus: order.status },
    });
  }

  /**
   * Concluir tudo de uma vez (gerencial; Maicol, 23/11/2026): finaliza as
   * etapas de produção e as dos itens das agendas escolhidas, para quem não
   * usou a agenda do jeito certo limpar e começar de novo. Entrega e Cliente
   * Retira ficam como estão; a venda que segue o gerenciador fica de fora
   * (skipped), e a agenda cancelada ou já entregue também (closed): concluir
   * as etapas dela a traria de volta para a entrega. Cada etapa guarda o
   * estado de antes (prevStatus), como na troca de uma etapa.
   */
  async finishAll(scheduleIds: string[], companyId: string) {
    const schedules = await this.prisma.deliverySchedule.findMany({
      where: { id: { in: scheduleIds }, ...scheduleOfCompany(companyId) },
      select: { id: true, status: true },
    });
    const ids: string[] = [];
    let skipped = 0;
    let closed = 0;
    for (const { id, status } of schedules) {
      if (CLOSED_SCHEDULE.includes(status)) {
        closed++;
        continue;
      }
      if (await this.isManaged(id)) {
        skipped++;
        continue;
      }
      ids.push(id);
    }
    if (ids.length) {
      // Um updateMany por estado aberto: cada etapa grava o próprio anterior
      await this.prisma.$transaction([
        ...OPEN.map((status) =>
          this.prisma.productionItemStage.updateMany({
            where: { scheduleId: { in: ids }, status },
            data: { status: 'DONE', prevStatus: status },
          }),
        ),
        ...OPEN.map((status) =>
          this.prisma.productionStage.updateMany({
            where: {
              scheduleId: { in: ids },
              status,
              OR: [
                { stageId: null },
                { stage: { name: { notIn: DELIVERY_STAGES } } },
              ],
            },
            data: { status: 'DONE', prevStatus: status },
          }),
        ),
      ]);
    }
    for (const id of ids) await this.updateStatusIfAllStagesAreDone(id);
    return {
      finished: ids.length,
      skipped,
      closed,
      notFound: scheduleIds.length - schedules.length,
    };
  }

  async updateStatusIfAllStagesAreDone(scheduleId: string) {
    // Buscar o status atual da entrega
    const deliverySchedule = await this.prisma.deliverySchedule.findUnique({
      where: { id: scheduleId },
      select: { status: true },
    });

    // Entregue ou cancelada, não faz nada: a cancelada voltaria para a
    // produção ou a entrega
    if (
      !deliverySchedule ||
      CLOSED_SCHEDULE.includes(deliverySchedule.status)
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
      (stage) => !DELIVERY_STAGES.includes(stage.stage?.name ?? ''),
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
    if (await this.isManaged(scheduleId)) {
      throw new ConflictException(MANAGED_BY_PRODUCTION);
    }
  }

  private async isManaged(scheduleId: string) {
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
    return managed > 0;
  }

  async remove(id: string, companyId: string) {
    const stage = await this.findOne(id, companyId);
    await this.assertNotManaged(stage.scheduleId);
    return this.prisma.productionStage.delete({ where: { id } });
  }
}
