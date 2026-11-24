import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OrderRedo, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from 'nestjs-prisma';

import { PlanControlService } from '../../plan/plan-control.service';
import { ProductionMirrorService } from '../../production/production-mirror.service';
import { assertCancelReason } from '../order/cancel-reason';
import { OrderService } from '../order/order.service';
import { planCarry, RedoItem } from '../order/order-redo';
import { QuotationCrudService } from './quotation-crud.service';

const bad = (message: string): never => {
  throw new BadRequestException(message);
};

export type RedoActor = { companyId: string; userId: string; name: string };

/**
 * A O.S. que não se refaz: cancelada, concluída (a produção pronta, a
 * "Concluída" da lista de O.S.) ou finalizada (entregue).
 */
const CLOSED_ORDER: OrderStatus[] = ['CANCELED', 'COMPLETED', 'FINISHED'];
const ORDER_CLOSED = 'A O.S. cancelada, concluída ou finalizada não se refaz';
const DECIDED = 'Este pedido já foi decidido';
/** Os pedidos que ainda podem gerar a cópia: barram um pedido novo */
const OPEN_REDO: OrderRedo['status'][] = ['PENDING_APPROVAL', 'EXECUTING'];

/**
 * Um pedido por vez por O.S.: dois pedidos ao mesmo tempo contariam nenhum
 * aberto e nasceriam os dois. A trava, presa até o fim da transação, faz o
 * segundo esperar o primeiro e ver o pedido dele (o padrão de
 * stock/purchasing/numbering.ts).
 */
const lockOrder = (tx: Prisma.TransactionClient, orderId: string) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`order-redo:${orderId}`}))`;

type Measure = { width?: number; height?: number };

/**
 * Refazer a O.S. (GP-51; Maicol, 23/11/2026). A O.S. aprovada não se altera:
 * para mudar, cancela-se e faz-se outra, numa ação só.
 * - Pedir: o motivo, quem fica com o excedente (o cliente paga o que já foi
 *   produzido, ou a empresa fica com a perda) e o motivo do cancelamento da
 *   antiga (obrigatório como na rota de cancelar).
 * - Com produção ou material já baixado, outra pessoa aprova (quem pede não
 *   aprova), com a chave "Aprovar refazer a O.S.". Sem nada feito, executa já.
 * - Executar: reservado de uma vez (EXECUTING), para dois cliques não gerarem
 *   duas cópias; a O.S. é reconferida; a nova nasce como cópia em digitação,
 *   ligada à antiga, e a antiga é cancelada pelo cancelamento de sempre (o
 *   financeiro segue a ALT-7: o que foi pago fica, e levar para a nova é
 *   manual). O que parar no meio deixa o pedido FAILED, com o motivo.
 * - Aprovada a nova: as etapas feitas na antiga concluem as mesmas etapas
 *   na nova, quando o item é o mesmo; o excedente fica registrado.
 * Nada produzido ou baixado é apagado: fica na O.S. antiga, cancelada.
 */
@Injectable()
export class OrderRedoService {
  private readonly logger = new Logger(OrderRedoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crud: QuotationCrudService,
    private readonly orders: OrderService,
    private readonly plan: PlanControlService,
    private readonly mirror: ProductionMirrorService,
  ) {}

  async list(companyId: string, orderId: string) {
    return this.prisma.orderRedo.findMany({
      where: { companyId, orderId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async pending(companyId: string) {
    return this.prisma.orderRedo.findMany({
      where: { companyId, status: 'PENDING_APPROVAL' },
      orderBy: { createdAt: 'asc' },
    });
  }

  async request(
    actor: RedoActor,
    orderId: string,
    dto: {
      reason: string;
      excess: 'CLIENT' | 'COMPANY';
      responsibleKind?: 'PERSON' | 'SECTOR';
      responsibleId?: string;
      /** O motivo do cancelamento da O.S. antiga */
      reasonId?: string;
    },
  ) {
    const reason = dto.reason?.trim() || bad('Diga o motivo');
    // O responsável pela refação: a pessoa ou o setor, da empresa
    let responsibleName: string | null = null;
    if (dto.responsibleKind && dto.responsibleId) {
      const found =
        dto.responsibleKind === 'PERSON'
          ? await this.prisma.employee.findFirst({
              where: { id: dto.responsibleId, companyId: actor.companyId },
              select: { name: true },
            })
          : await this.prisma.companySector.findFirst({
              where: { id: dto.responsibleId, companyId: actor.companyId },
              select: { name: true },
            });
      if (!found) throw new NotFoundException('Responsável não encontrado');
      responsibleName = found.name;
    }
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, quotation: { companyId: actor.companyId } },
      select: { id: true, status: true, quotationId: true },
    });
    if (!order) throw new NotFoundException('Ordem de serviço não encontrada');
    if (CLOSED_ORDER.includes(order.status)) bad(ORDER_CLOSED);

    // Refazer cancela a antiga: o motivo segue a regra da rota de cancelar
    const cancelReasonId = dto.reasonId || null;
    await assertCancelReason(
      this.plan,
      (companyId) => this.orders.countCancelReasons(companyId),
      actor.companyId,
      cancelReasonId,
    );
    if (cancelReasonId) {
      const found = await this.prisma.reasons.findFirst({
        where: { id: cancelReasonId, companyId: actor.companyId },
        select: { id: true },
      });
      if (!found) {
        throw new NotFoundException('Motivo de cancelamento não encontrado.');
      }
    }

    const [tasks, stages, moves] = await Promise.all([
      this.prisma.productionTask.count({
        where: {
          project: { quotationId: order.quotationId },
          status: { not: 'NOT_STARTED' },
        },
      }),
      this.prisma.productionStage.count({
        where: {
          status: { notIn: ['NOT_STARTED', 'CANCELED'] },
          schedule: {
            OR: [
              { quotationId: order.quotationId },
              { order: { quotationId: order.quotationId } },
            ],
          },
        },
      }),
      this.prisma.stockMovement.count({
        where: { companyId: actor.companyId, quotationId: order.quotationId },
      }),
    ]);
    const needsApproval = tasks + stages + moves > 0;
    // Sem aprovação, quem pede executa e cancela a antiga: confere antes de
    // registrar, para não sobrar pedido nem cópia
    if (!needsApproval) await this.orders.verifySellerPermission(actor.userId);

    const redo = await this.prisma.$transaction(async (tx) => {
      await lockOrder(tx, orderId);
      const open = await tx.orderRedo.count({
        where: { orderId, status: { in: OPEN_REDO } },
      });
      if (open) {
        bad(
          'Já há um pedido para refazer esta O.S. esperando aprovação ou em execução',
        );
      }
      return tx.orderRedo.create({
        data: {
          companyId: actor.companyId,
          orderId,
          oldQuotationId: order.quotationId,
          reason,
          excess: dto.excess,
          responsibleKind: responsibleName ? dto.responsibleKind : null,
          responsibleId: responsibleName ? dto.responsibleId : null,
          responsibleName,
          cancelReasonId,
          needsApproval,
          // Sem aprovação, já nasce reservado para quem pediu executar
          status: needsApproval ? 'PENDING_APPROVAL' : 'EXECUTING',
          produced: { tasks, stages, stockMovements: moves },
          requestedById: actor.userId,
          requestedByName: actor.name,
        },
      });
    });
    if (!needsApproval) return this.run(actor, redo);
    return redo;
  }

  async approve(actor: RedoActor, id: string) {
    const redo = await this.find(actor.companyId, id);
    if (redo.status !== 'PENDING_APPROVAL') {
      throw new ConflictException(DECIDED);
    }
    if (redo.requestedById === actor.userId) {
      throw new ForbiddenException('Quem pediu para refazer não aprova');
    }
    // Quem aprova cancela a antiga: confere antes de reservar e de copiar.
    // Sem a permissão, o pedido segue esperando outra pessoa
    await this.orders.verifySellerPermission(actor.userId);
    // A reserva: só um clique passa daqui
    const claimed = await this.prisma.orderRedo.updateMany({
      where: { id, companyId: actor.companyId, status: 'PENDING_APPROVAL' },
      data: {
        status: 'EXECUTING',
        approvedById: actor.userId,
        approvedByName: actor.name,
      },
    });
    if (!claimed.count) throw new ConflictException(DECIDED);
    return this.run(actor, redo);
  }

  async reject(actor: RedoActor, id: string, reason: string) {
    await this.find(actor.companyId, id);
    const rejected = await this.prisma.orderRedo.updateMany({
      where: { id, companyId: actor.companyId, status: 'PENDING_APPROVAL' },
      data: {
        status: 'REJECTED',
        rejectReason: reason?.trim() || null,
        approvedById: actor.userId,
        approvedByName: actor.name,
      },
    });
    if (!rejected.count) throw new ConflictException(DECIDED);
    return this.find(actor.companyId, id);
  }

  /**
   * Executa o pedido já reservado (EXECUTING): reconfere a O.S., faz a cópia
   * e cancela a antiga. O que parar no meio deixa o pedido FAILED, com o
   * motivo e a cópia (se já nasceu): ele não fica pendente, não barra
   * pedidos novos e não gera outra cópia.
   */
  private async run(actor: RedoActor, redo: OrderRedo) {
    let copyId: string | null = null;
    try {
      // Entre o pedido e a aprovação a O.S. pode ter sido entregue ou
      // cancelada: aí o pedido não vale mais
      const order = await this.prisma.order.findUnique({
        where: { id: redo.orderId },
        select: { status: true },
      });
      if (!order) {
        throw new NotFoundException('Ordem de serviço não encontrada');
      }
      if (CLOSED_ORDER.includes(order.status)) {
        throw new ConflictException(ORDER_CLOSED);
      }
      const old = await this.prisma.quotation.findUnique({
        where: { id: redo.oldQuotationId },
        select: {
          description: true,
          quotationNumber: true,
          series: { select: { code: true } },
        },
      });
      const reference = [old?.quotationNumber, old?.series?.code]
        .filter((part) => part !== null && part !== undefined && part !== '')
        .join('-');
      const copy = await this.crud.duplicate(
        redo.oldQuotationId,
        {
          description: `${old?.description || 'O.S.'} (refaz a O.S. ${reference})`,
        } as never,
        actor.userId,
      );
      copyId = copy.id;
      await this.orders.cancelOrder(
        redo.orderId,
        redo.cancelReasonId ? { reasonId: redo.cancelReasonId } : {},
        actor.userId,
      );
    } catch (error) {
      if (!(error instanceof HttpException)) {
        this.logger.error(
          `Refazer a O.S. ${redo.orderId} (pedido ${redo.id}): ${error?.message}`,
          error?.stack,
        );
      }
      const cause =
        error instanceof HttpException
          ? error.message.replace(/\.$/, '')
          : 'Erro inesperado';
      const failReason = copyId
        ? `${cause}. A O.S. nova (a cópia) ficou em digitação`
        : cause;
      await this.prisma.orderRedo.update({
        where: { id: redo.id },
        data: { status: 'FAILED', failReason, newQuotationId: copyId },
      });
      if (!copyId && error instanceof HttpException) throw error;
      throw new ConflictException(`Não deu para refazer a O.S.: ${failReason}`);
    }
    return this.prisma.orderRedo.update({
      where: { id: redo.id },
      data: { status: 'EXECUTED', newQuotationId: copyId },
    });
  }

  /**
   * Aprovada a O.S. nova: as etapas feitas na antiga concluem as mesmas
   * etapas na nova, pelo item correspondente, quando o item é o mesmo
   * (produto, variação, medidas e quantidade que cabe no que foi feito);
   * a que não passa fica no histórico com o motivo. O excedente fica
   * registrado. Uma vez só por pedido de refazer.
   */
  async carryOver(quotationId: string) {
    const redo = await this.prisma.orderRedo.findFirst({
      where: {
        newQuotationId: quotationId,
        status: 'EXECUTED',
        carriedAt: null,
      },
    });
    if (!redo) return;
    const items = (id: string) =>
      this.prisma.quotationProduct.findMany({
        where: { quotationId: id },
        select: {
          id: true,
          productId: true,
          materialId: true,
          variationId: true,
          materialVariationId: true,
          quantity: true,
          description: true,
          snapshot: { select: { data: true } },
          items: {
            select: { width: true, height: true },
            orderBy: { createdAt: 'asc' },
            take: 1,
          },
        },
        orderBy: { createdAt: 'asc' },
      });
    const tasks = (id: string) =>
      this.prisma.productionTask.findMany({
        where: { project: { quotationId: id } },
        select: {
          id: true,
          quotationProductId: true,
          stageKey: true,
          status: true,
        },
      });
    const [oldItems, newItems, oldTasks, newTasks] = await Promise.all([
      items(redo.oldQuotationId),
      items(quotationId),
      tasks(redo.oldQuotationId),
      tasks(quotationId),
    ]);
    // As medidas como a produção lê: o retrato do item, ou a primeira linha
    const toItem = (row: (typeof oldItems)[number]): RedoItem => {
      const measure = (
        row.snapshot?.data as { measure?: Measure } | null | undefined
      )?.measure;
      return {
        id: row.id,
        productId: row.productId,
        materialId: row.materialId,
        variationId: row.variationId ?? row.materialVariationId ?? null,
        width: measure?.width || row.items?.[0]?.width || null,
        height: measure?.height || row.items?.[0]?.height || null,
        quantity: row.quantity,
        name: row.description || 'Item',
      };
    };
    const { carry, blocked, losses } = planCarry(
      oldItems.map(toItem),
      newItems.map(toItem),
      oldTasks,
      newTasks,
    );
    const now = new Date();
    const byName = redo.approvedByName || redo.requestedByName;
    const carried = await this.prisma.$transaction(async (tx) => {
      // Uma vez só: a segunda aprovação ao mesmo tempo para aqui
      const claimed = await tx.orderRedo.updateMany({
        where: { id: redo.id, carriedAt: null },
        data: { carriedAt: now },
      });
      if (!claimed.count) return null;
      let count = 0;
      for (const taskId of carry) {
        const done = await tx.productionTask.updateMany({
          where: { id: taskId, status: 'NOT_STARTED' },
          data: {
            status: 'DONE',
            completedAt: now,
            completedBy: 'Feita na O.S. anterior',
          },
        });
        if (!done.count) continue;
        count++;
        await tx.productionTaskHistory.create({
          data: {
            taskId,
            byName,
            text: 'Concluída: a etapa já tinha sido feita na O.S. refeita',
          },
        });
      }
      for (const { taskId, reason } of blocked) {
        await tx.productionTaskHistory.create({
          data: {
            taskId,
            byName,
            text: `Feita na O.S. refeita, mas não passou para esta: ${reason}`,
          },
        });
      }
      await tx.orderRedo.update({
        where: { id: redo.id },
        data: {
          carried: count,
          lossItems: losses as unknown as Prisma.InputJsonValue,
        },
      });
      return count;
    });
    if (!carried) return;
    // A agenda de entrega do ELITE espelha as tarefas: acompanha a
    // conclusão, como nos outros caminhos da produção
    const project = await this.prisma.productionProject.findUnique({
      where: { quotationId },
      select: { id: true },
    });
    if (project) await this.mirror.sync(project.id);
  }

  private async find(companyId: string, id: string) {
    const redo = await this.prisma.orderRedo.findFirst({
      where: { id, companyId },
    });
    if (!redo) throw new NotFoundException('Pedido não encontrado');
    return redo;
  }
}
