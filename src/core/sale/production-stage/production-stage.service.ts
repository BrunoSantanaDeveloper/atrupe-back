import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  DeliveryScheduleStatus,
  Prisma,
  ProductionStageStatus,
} from '@prisma/client';
import { UpdateProductionStageDto } from './dto/update-production-stage.dto';
import { UpdateItemStageDto, WorkListQueryDto } from './dto/item-stage.dto';
import {
  ItemStage,
  OPEN,
  StageStatus,
  itemChanges,
  orderStatusAfter,
} from './stage-aggregate';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { assertBelongsToCompany } from 'src/shared/tenant/company-scope';
import { compositionMeasure } from '../quotation/quotation-items.service';

const STAGE_NOT_FOUND = 'Etapa de produção nao encontrada';
const MANAGED_BY_PRODUCTION =
  'As etapas desta venda seguem o gerenciador de produção';
const ITEM_STAGE_NOT_FOUND = 'Etapa do item não encontrada';
export const FIXED_STAGE =
  'Esta etapa é cobrada na composição do produto e não sai do pedido';
export const STAGE_ALREADY_IN_ORDER = 'O pedido já passa por este setor';
// Entrega e Cliente Retira não são etapas de produção
const DELIVERY_STAGES = ['Entrega', 'Cliente Retira'];
/** A agenda fechada: entregue (FINISHED, DONE) ou cancelada */
const CLOSED_SCHEDULE: DeliveryScheduleStatus[] = [
  'CANCELED',
  'FINISHED',
  'DONE',
];

/** Quem age na etapa: o nome fica gravado ao concluir (§4.16). */
export type StageActor = { userId?: string | null; name?: string | null };

/**
 * Concluir grava quem e quando; sair de concluído limpa. Sem mudança de
 * concluído (a pendência, a volta de outro estado), não mexe.
 */
const doneData = (
  status: string | undefined,
  actor?: StageActor,
  from?: string | null,
) =>
  status === 'DONE' && from !== 'DONE'
    ? {
        doneAt: new Date(),
        doneById: actor?.userId ?? null,
        doneByName: actor?.name ?? null,
      }
    : status && status !== 'DONE' && from === 'DONE'
      ? { doneAt: null, doneById: null, doneByName: null }
      : {};

/** "4 un · 1 × 0,5 m", como na Agenda de entrega (design §7). */
const workMeasure = (
  quantity: number,
  lines: { quantity: number; width: number | null; height: number | null }[],
) => {
  const mm = (value: number) =>
    (value / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  const {
    quantity: total,
    width,
    height,
  } = compositionMeasure(quantity, lines);
  const size =
    width && height
      ? ` · ${mm(width)} × ${mm(height)} m`
      : width
        ? ` · ${mm(width)} m`
        : '';
  return `${total} un${size}`;
};

const WORK_OPEN: ProductionStageStatus[] = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'PAUSED',
  'PENDING',
  'WAITING_PRODUCTION',
  'OVERDUE',
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
    actor?: StageActor,
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
          actor,
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
  async updateItem(
    id: string,
    dto: UpdateItemStageDto,
    companyId: string,
    actor?: StageActor,
  ) {
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
        ...doneData(dto.status, actor, item.status),
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
    actor?: StageActor,
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
          ...doneData(
            item.status,
            actor,
            items.find((row) => row.id === item.id)?.status,
          ),
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
  async finishAll(
    scheduleIds: string[],
    companyId: string,
    actor?: StageActor,
  ) {
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
            // Quem concluiu fica gravado (§4.16)
            data: {
              status: 'DONE',
              prevStatus: status,
              ...doneData('DONE', actor, status),
            },
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

  /**
   * A lista de trabalhos do LITE (área 9 §4.16; Maicol, 26/11/2026): as
   * etapas dos itens, de todos os setores ou de um, na ordem da entrega. É o
   * mesmo registro da Agenda de entrega: concluir aqui conclui lá. A venda
   * que segue o gerenciador (ELITE) fica de fora.
   */
  async workList(companyId: string, query: WorkListQueryDto) {
    const done = query.view === 'done';
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const base: Prisma.ProductionItemStageWhereInput = {
      schedule: {
        AND: [
          scheduleOfCompany(companyId),
          { isActive: true },
          done ? {} : { status: { in: ['IN_PRODUCTION', 'DELIVERING'] } },
        ],
      },
      quotationProduct: { quotation: { productionProject: null } },
      status: done ? 'DONE' : { in: WORK_OPEN },
      ...(done ? { updatedAt: { gte: since } } : {}),
    };
    const [rows, counts] = await Promise.all([
      this.prisma.productionItemStage.findMany({
        where: {
          ...base,
          ...(query.stageId ? { stageId: query.stageId } : {}),
        },
        include: {
          stage: { select: { id: true, name: true, icon: true, color: true } },
          schedule: {
            select: { id: true, scheduledDate: true, addScheduleTime: true },
          },
          quotationProduct: {
            select: {
              id: true,
              description: true,
              quantity: true,
              items: {
                select: { quantity: true, width: true, height: true },
                orderBy: { createdAt: 'asc' },
              },
              quotation: {
                select: {
                  id: true,
                  quotationNumber: true,
                  description: true,
                  series: { select: { code: true } },
                  client: { select: { name: true } },
                },
              },
            },
          },
        },
        orderBy: done
          ? [{ doneAt: 'desc' }, { updatedAt: 'desc' }]
          : [{ schedule: { scheduledDate: 'asc' } }, { order: 'asc' }],
        take: 300,
      }),
      done
        ? Promise.resolve([])
        : this.prisma.productionItemStage.groupBy({
            by: ['stageId'],
            where: base,
            _count: { _all: true },
          }),
    ]);

    // O que ainda falta antes, no mesmo item: "depois de Impressão"
    const siblings = rows.length
      ? await this.prisma.productionItemStage.findMany({
          where: {
            quotationProductId: {
              in: [...new Set(rows.map((row) => row.quotationProductId))],
            },
          },
          select: {
            id: true,
            quotationProductId: true,
            scheduleId: true,
            order: true,
            status: true,
            stage: {
              select: { id: true, name: true, icon: true, color: true },
            },
          },
          orderBy: { order: 'asc' },
        })
      : [];

    return {
      counts: Object.fromEntries(
        (counts as { stageId: string; _count: { _all: number } }[]).map(
          (row) => [row.stageId, row._count._all],
        ),
      ),
      items: rows.map((row) => {
        const quotation = row.quotationProduct.quotation;
        return {
          id: row.id,
          status: row.status,
          notes: row.notes,
          fixed: row.fixed,
          doneAt: row.doneAt,
          doneByName: row.doneByName,
          sector: row.stage,
          scheduleId: row.scheduleId,
          scheduledDate: row.schedule.scheduledDate,
          addScheduleTime: row.schedule.addScheduleTime,
          quotationId: quotation.id,
          reference: [quotation.quotationNumber, quotation.series?.code]
            .filter(
              (part) => part !== null && part !== undefined && part !== '',
            )
            .join('-'),
          client: quotation.client?.name ?? null,
          description: quotation.description,
          item: row.quotationProduct.description ?? '',
          measure: workMeasure(
            row.quotationProduct.quantity,
            row.quotationProduct.items,
          ),
          // O fluxo inteiro do item, só para ver (§4.16): na tela do setor
          // se conclui só a etapa dele
          flow: siblings
            .filter(
              (other) =>
                other.quotationProductId === row.quotationProductId &&
                other.scheduleId === row.scheduleId,
            )
            .map((other) => ({
              id: other.id,
              sector: other.stage,
              status: other.status,
              current: other.id === row.id,
            })),
          waitingFor: siblings
            .filter(
              (other) =>
                other.quotationProductId === row.quotationProductId &&
                other.scheduleId === row.scheduleId &&
                other.order < row.order &&
                !['DONE', 'CANCELED'].includes(other.status),
            )
            .map((other) => other.stage.name),
        };
      }),
    };
  }

  /**
   * Acrescenta ao pedido um ícone livre (área 9 §4.16; Maicol, 26/11/2026):
   * o setor entra antes da Entrega ou do Cliente Retira, e cada item do
   * pedido passa por ele.
   */
  async addToSchedule(scheduleId: string, stageId: string, companyId: string) {
    const schedule = await this.prisma.deliverySchedule.findFirst({
      where: { id: scheduleId, ...scheduleOfCompany(companyId) },
      select: { id: true, status: true },
    });
    if (!schedule) throw new NotFoundException('Agenda não encontrada');
    if (['FINISHED', 'DONE'].includes(schedule.status)) {
      throw new BadRequestException('A entrega deste pedido já foi concluída');
    }
    await this.assertNotManaged(scheduleId);
    const sector = await this.prisma.companySector.findFirst({
      where: {
        id: stageId,
        companyId,
        isActive: true,
        isProductionStage: true,
      },
      select: { id: true, name: true },
    });
    if (!sector || DELIVERY_STAGES.includes(sector.name)) {
      throw new NotFoundException('Setor não encontrado.');
    }
    const stages = await this.prisma.productionStage.findMany({
      where: { scheduleId },
      select: { id: true, stageId: true, order: true, stage: true },
      orderBy: { order: 'asc' },
    });
    if (stages.some((stage) => stage.stageId === stageId)) {
      throw new ConflictException(STAGE_ALREADY_IN_ORDER);
    }
    const delivery = stages.filter((stage) =>
      DELIVERY_STAGES.includes(stage.stage?.name ?? ''),
    );
    const production = stages.filter((stage) => !delivery.includes(stage));
    const order =
      Math.max(0, ...production.map((stage) => stage.order ?? 0)) + 1;
    const items = await this.prisma.quotationProduct.findMany({
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
      select: {
        id: true,
        productionItemStages: {
          where: { scheduleId },
          select: { order: true },
        },
      },
    });
    await this.prisma.$transaction(async (tx) => {
      for (const [index, stage] of delivery.entries()) {
        await tx.productionStage.update({
          where: { id: stage.id },
          data: { order: order + 1 + index },
        });
      }
      await tx.productionStage.create({
        data: { scheduleId, stageId, order, prevStatus: null },
      });
      if (items.length) {
        await tx.productionItemStage.createMany({
          data: items.map((item) => ({
            scheduleId,
            quotationProductId: item.id,
            stageId,
            order:
              Math.max(0, ...item.productionItemStages.map((s) => s.order)) + 1,
          })),
        });
      }
    });
    // O pedido que estava pronto volta a ter o que fazer
    await this.updateStatusIfAllStagesAreDone(scheduleId);
    return { ok: true };
  }

  /**
   * Tira o ícone do pedido. O fixo, que veio de uma etapa de cobrança do
   * produto (§4.16), não sai; o livre sai do pedido e dos itens.
   */
  async remove(id: string, companyId: string) {
    const stage = await this.findOne(id, companyId);
    await this.assertNotManaged(stage.scheduleId);
    if (stage.stageId) {
      const fixed = await this.prisma.productionItemStage.count({
        where: {
          scheduleId: stage.scheduleId,
          stageId: stage.stageId,
          fixed: true,
        },
      });
      if (fixed > 0) throw new BadRequestException(FIXED_STAGE);
    }
    const removed = await this.prisma.$transaction(async (tx) => {
      if (stage.stageId) {
        await tx.productionItemStage.deleteMany({
          where: { scheduleId: stage.scheduleId, stageId: stage.stageId },
        });
      }
      return tx.productionStage.delete({ where: { id } });
    });
    await this.updateStatusIfAllStagesAreDone(stage.scheduleId);
    return removed;
  }
}
