import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'nestjs-prisma';

import { OrderService } from '../order/order.service';
import { planCarry, RedoItem } from '../order/order-redo';
import { QuotationCrudService } from './quotation-crud.service';

const bad = (message: string): never => {
  throw new BadRequestException(message);
};

export type RedoActor = { companyId: string; userId: string; name: string };

/**
 * Refazer a O.S. (GP-51; Maicol, 23/11/2026). A O.S. aprovada não se altera:
 * para mudar, cancela-se e faz-se outra, numa ação só.
 * - Pedir: o motivo e quem fica com o excedente (o cliente paga o que já foi
 *   produzido, ou a empresa fica com a perda).
 * - Com produção ou material já baixado, outra pessoa aprova (quem pede não
 *   aprova), com a chave "Aprovar refazer a O.S.". Sem nada feito, executa já.
 * - Executar: a O.S. nova nasce como cópia em digitação, ligada à antiga, e
 *   a antiga é cancelada pelo cancelamento de sempre (o financeiro segue a
 *   ALT-7: o que foi pago fica, e levar para a nova é manual).
 * - Aprovada a nova: as etapas feitas na antiga concluem as mesmas etapas
 *   na nova, pelo item correspondente; o excedente fica registrado.
 * Nada produzido ou baixado é apagado: fica na O.S. antiga, cancelada.
 */
@Injectable()
export class OrderRedoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crud: QuotationCrudService,
    private readonly orders: OrderService,
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
    if (order.status === 'CANCELED' || order.status === 'FINISHED') {
      bad('A O.S. cancelada ou finalizada não se refaz');
    }
    const open = await this.prisma.orderRedo.count({
      where: { orderId, status: 'PENDING_APPROVAL' },
    });
    if (open) bad('Já há um pedido para refazer esta O.S. esperando aprovação');

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
    const redo = await this.prisma.orderRedo.create({
      data: {
        companyId: actor.companyId,
        orderId,
        oldQuotationId: order.quotationId,
        reason,
        excess: dto.excess,
        responsibleKind: responsibleName ? dto.responsibleKind : null,
        responsibleId: responsibleName ? dto.responsibleId : null,
        responsibleName,
        needsApproval,
        produced: { tasks, stages, stockMovements: moves },
        requestedById: actor.userId,
        requestedByName: actor.name,
      },
    });
    if (!needsApproval) return this.execute(actor, redo.id);
    return redo;
  }

  async approve(actor: RedoActor, id: string) {
    const redo = await this.find(actor.companyId, id);
    if (redo.status !== 'PENDING_APPROVAL') bad('Este pedido já foi decidido');
    if (redo.requestedById === actor.userId) {
      throw new ForbiddenException('Quem pediu para refazer não aprova');
    }
    return this.execute(actor, id);
  }

  async reject(actor: RedoActor, id: string, reason: string) {
    const redo = await this.find(actor.companyId, id);
    if (redo.status !== 'PENDING_APPROVAL') bad('Este pedido já foi decidido');
    return this.prisma.orderRedo.update({
      where: { id },
      data: {
        status: 'REJECTED',
        rejectReason: reason?.trim() || null,
        approvedById: actor.userId,
        approvedByName: actor.name,
      },
    });
  }

  private async execute(actor: RedoActor, id: string) {
    const redo = await this.find(actor.companyId, id);
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
    await this.orders.cancelOrder(redo.orderId, {}, actor.userId);
    return this.prisma.orderRedo.update({
      where: { id },
      data: {
        status: 'EXECUTED',
        newQuotationId: copy.id,
        approvedById: redo.needsApproval ? actor.userId : null,
        approvedByName: redo.needsApproval ? actor.name : null,
      },
    });
  }

  /**
   * Aprovada a O.S. nova: as etapas feitas na antiga concluem as mesmas
   * etapas na nova, pelo item correspondente; o excedente fica registrado.
   * Uma vez só por pedido de refazer.
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
          quantity: true,
          description: true,
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
    const toItem = (row: (typeof oldItems)[number]): RedoItem => ({
      id: row.id,
      productId: row.productId,
      materialId: row.materialId,
      quantity: row.quantity,
      name: row.description || 'Item',
    });
    const { carry, losses } = planCarry(
      oldItems.map(toItem),
      newItems.map(toItem),
      oldTasks,
      newTasks,
    );
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      for (const taskId of carry) {
        await tx.productionTask.update({
          where: { id: taskId },
          data: {
            status: 'DONE',
            completedAt: now,
            completedBy: 'Feita na O.S. anterior',
          },
        });
        await tx.productionTaskHistory.create({
          data: {
            taskId,
            byName: redo.approvedByName || redo.requestedByName,
            text: 'Concluída: a etapa já tinha sido feita na O.S. refeita',
          },
        });
      }
      await tx.orderRedo.update({
        where: { id: redo.id },
        data: {
          carriedAt: now,
          carried: carry.length,
          lossItems: losses as unknown as Prisma.InputJsonValue,
        },
      });
    });
  }

  private async find(companyId: string, id: string) {
    const redo = await this.prisma.orderRedo.findFirst({
      where: { id, companyId },
    });
    if (!redo) throw new NotFoundException('Pedido não encontrado');
    return redo;
  }
}
