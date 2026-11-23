import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'nestjs-prisma';
import type { CashActor } from '../../financial/cash-control/cash-ledger';
import { UNIT_SYMBOL } from '../../material/material-text';
import { PricingParametersService } from '../../pricing/pricing-parameters.service';
import { StockService } from '../stock.service';
import { enterStock, stockKey } from '../stock-entry';
import { installmentsOf } from './lot-math';
import { lockNumbering } from './numbering';
import {
  CheckOrderDto,
  CloseOrderDto,
  PayablesDto,
  PurchaseOrderDto,
  PurchaseOrderFilterDto,
  PurchaseQuoteDto,
  PurchaseRequestDto,
  PurchaseRequestFilterDto,
  ReceiveOrderDto,
} from './purchasing.dto';

const bad = (message: string): never => {
  throw new BadRequestException(message);
};
const REQUEST_NOT_FOUND = 'Solicitação não encontrada';
const ORDER_NOT_FOUND = 'Pedido de compra não encontrado';
const day = (date: Date | null) =>
  date ? date.toISOString().slice(0, 10) : null;
const dateOf = (value?: string | null) =>
  value ? new Date(`${value}T12:00:00.000Z`) : null;
const brQty = (value: number) =>
  value.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

const REQUEST_INCLUDE = {
  quotes: { orderBy: { createdAt: 'asc' } },
  events: { orderBy: { at: 'asc' } },
} satisfies Prisma.PurchaseRequestInclude;

const ORDER_INCLUDE = {
  items: { orderBy: { description: 'asc' } },
  events: { orderBy: { at: 'asc' } },
} satisfies Prisma.PurchaseOrderInclude;

type RequestRow = Prisma.PurchaseRequestGetPayload<{
  include: typeof REQUEST_INCLUDE;
}>;
type OrderRow = Prisma.PurchaseOrderGetPayload<{
  include: typeof ORDER_INCLUDE;
}>;

/**
 * As compras do FULL (ES-13 a ES-17; Maicol, 22/11/2026), como na primeira
 * versão: a solicitação (aberta a quem tem a permissão, com quem pediu e a
 * linha do tempo), a cotação com os fornecedores, o pedido que nasce das
 * cotações escolhidas (ou direto), a entrega, a conferência com a nota e a
 * entrada no estoque, com os lotes e as contas a pagar.
 *
 * A entrada no estoque acontece uma vez: pela nota conferida (o custo real
 * dela), ou, sem nota, pelos preços do pedido e o que chegou.
 */
@Injectable()
export class PurchasingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly pricing: PricingParametersService,
  ) {}

  /* ------------------------------------------------------ solicitação */

  private async materialText(
    companyId: string,
    materialId?: string | null,
    variationId?: string | null,
  ) {
    if (!materialId) return null;
    const material = await this.prisma.material.findFirst({
      where: { id: materialId, companyId },
      select: { name: true, unit: true },
    });
    if (!material) throw new NotFoundException('Material não encontrado');
    const variation = variationId
      ? await this.prisma.materialVariation.findFirst({
          where: { id: variationId, materialId },
          select: { brand: true, color: true },
        })
      : null;
    if (variationId && !variation) {
      throw new NotFoundException('Variação não encontrada');
    }
    const label = [variation?.brand, variation?.color]
      .filter(Boolean)
      .join(' · ');
    return {
      description: label ? `${material.name} · ${label}` : material.name,
      unit: UNIT_SYMBOL[material.unit] ?? '',
    };
  }

  private requestView(row: RequestRow) {
    return {
      id: row.id,
      number: row.number,
      materialId: row.materialId,
      variationId: row.variationId,
      description: row.description,
      quantity: row.quantity,
      unit: row.unit,
      neededBy: day(row.neededBy),
      note: row.note,
      status: row.status,
      requestedById: row.requestedById,
      requestedByName: row.requestedByName,
      cancelReason: row.cancelReason,
      createdAt: row.createdAt.toISOString(),
      quotes: row.quotes.map((quote) => ({
        id: quote.id,
        supplierId: quote.supplierId,
        supplierName: quote.supplierName,
        quantity: quote.quantity,
        unitPrice: quote.unitPrice,
        total: Math.round(quote.unitPrice * quote.quantity),
        deliveryDays: quote.deliveryDays,
        paymentTerms: quote.paymentTerms,
        validUntil: day(quote.validUntil),
        note: quote.note,
        chosen: quote.chosen,
        createdByName: quote.createdByName,
      })),
      events: row.events.map((event) => ({
        text: event.text,
        byName: event.byName,
        at: event.at.toISOString(),
      })),
    };
  }

  async requests(
    companyId: string,
    filter: PurchaseRequestFilterDto,
    actor: CashActor,
  ) {
    const search = filter.search?.trim();
    const rows = await this.prisma.purchaseRequest.findMany({
      where: {
        companyId,
        ...(filter.status && { status: filter.status }),
        ...(filter.mine === 'true' && actor.id && { requestedById: actor.id }),
        ...(search && {
          OR: [
            { description: { contains: search, mode: 'insensitive' } },
            { requestedByName: { contains: search, mode: 'insensitive' } },
          ],
        }),
      },
      include: REQUEST_INCLUDE,
      orderBy: { number: 'desc' },
      take: 300,
    });
    return rows.map((row) => this.requestView(row));
  }

  private async requestRow(companyId: string, id: string) {
    const row = await this.prisma.purchaseRequest.findFirst({
      where: { id, companyId },
      include: REQUEST_INCLUDE,
    });
    if (!row) throw new NotFoundException(REQUEST_NOT_FOUND);
    return row;
  }

  async request(companyId: string, id: string) {
    return this.requestView(await this.requestRow(companyId, id));
  }

  async createRequest(
    companyId: string,
    dto: PurchaseRequestDto,
    actor: CashActor,
  ) {
    const material = await this.materialText(
      companyId,
      dto.materialId,
      dto.variationId,
    );
    const description = material?.description || dto.description?.trim();
    if (!description) bad('Escolha o material ou descreva o que precisa');
    const id = await this.prisma.$transaction(async (tx) => {
      await lockNumbering(tx, 'purchase_requests', companyId);
      const last = await tx.purchaseRequest.aggregate({
        where: { companyId },
        _max: { number: true },
      });
      const row = await tx.purchaseRequest.create({
        data: {
          companyId,
          number: (last._max.number ?? 0) + 1,
          materialId: dto.materialId || null,
          variationId: dto.materialId ? dto.variationId || null : null,
          description: description!,
          quantity: dto.quantity,
          unit: material?.unit ?? dto.unit?.trim() ?? '',
          neededBy: dateOf(dto.neededBy),
          note: dto.note?.trim() || null,
          requestedById: actor.id,
          requestedByName: actor.name,
          events: {
            create: {
              companyId,
              text: `Solicitou ${brQty(dto.quantity)} ${material?.unit ?? dto.unit ?? ''}`.trim(),
              byName: actor.name,
            },
          },
        },
      });
      return row.id;
    });
    return this.request(companyId, id);
  }

  async cancelRequest(
    companyId: string,
    id: string,
    reason: string,
    actor: CashActor,
  ) {
    const row = await this.requestRow(companyId, id);
    if (row.status === 'ORDERED' || row.status === 'RECEIVED') {
      bad('A solicitação já virou pedido: cancele o pedido');
    }
    if (row.status === 'CANCELED') return this.requestView(row);
    const text = reason?.trim() || bad('Informe o motivo');
    await this.prisma.purchaseRequest.update({
      where: { id },
      data: {
        status: 'CANCELED',
        cancelReason: text,
        events: {
          create: { companyId, text: `Cancelou: ${text}`, byName: actor.name },
        },
      },
    });
    return this.request(companyId, id);
  }

  /* ---------------------------------------------------------- cotação */

  private async supplierName(
    companyId: string,
    supplierId?: string | null,
    name?: string,
  ) {
    if (supplierId) {
      const supplier = await this.prisma.supplier.findFirst({
        where: { id: supplierId, companyId },
        select: { id: true, name: true },
      });
      if (!supplier) throw new NotFoundException('Fornecedor não encontrado');
      return { supplierId: supplier.id, supplierName: supplier.name };
    }
    const text = name?.trim() || bad('Escolha ou informe o fornecedor');
    return { supplierId: null, supplierName: text! };
  }

  async addQuote(
    companyId: string,
    requestId: string,
    dto: PurchaseQuoteDto,
    actor: CashActor,
  ) {
    const row = await this.requestRow(companyId, requestId);
    if (row.status !== 'REQUESTED' && row.status !== 'QUOTING') {
      bad('Só a solicitação em aberto recebe cotação');
    }
    const supplier = await this.supplierName(
      companyId,
      dto.supplierId,
      dto.supplierName,
    );
    const quantity = dto.quantity ?? row.quantity;
    await this.prisma.$transaction([
      this.prisma.purchaseQuote.create({
        data: {
          companyId,
          requestId,
          ...supplier,
          quantity,
          unitPrice: dto.unitPrice,
          deliveryDays: dto.deliveryDays ?? null,
          paymentTerms: dto.paymentTerms?.trim() || null,
          validUntil: dateOf(dto.validUntil),
          note: dto.note?.trim() || null,
          createdByName: actor.name,
        },
      }),
      this.prisma.purchaseRequest.update({
        where: { id: requestId },
        data: {
          status: 'QUOTING',
          events: {
            create: {
              companyId,
              text: `Cotou com ${supplier.supplierName}`,
              byName: actor.name,
            },
          },
        },
      }),
    ]);
    return this.request(companyId, requestId);
  }

  async removeQuote(companyId: string, requestId: string, quoteId: string) {
    const row = await this.requestRow(companyId, requestId);
    const quote = row.quotes.find((item) => item.id === quoteId);
    if (!quote) throw new NotFoundException('Cotação não encontrada');
    if (quote.chosen) bad('A cotação já virou pedido');
    await this.prisma.purchaseQuote.delete({ where: { id: quoteId } });
    if (row.quotes.length === 1 && row.status === 'QUOTING') {
      await this.prisma.purchaseRequest.update({
        where: { id: requestId },
        data: { status: 'REQUESTED' },
      });
    }
    return this.request(companyId, requestId);
  }

  /**
   * Fechar o pedido (ES-14): as cotações escolhidas viram pedidos, um por
   * fornecedor; cada solicitação entra com a cotação dela.
   */
  async closeOrder(companyId: string, dto: CloseOrderDto, actor: CashActor) {
    const quotes = await this.prisma.purchaseQuote.findMany({
      where: { id: { in: dto.quoteIds }, companyId },
      include: { request: true },
    });
    if (quotes.length !== new Set(dto.quoteIds).size) {
      throw new NotFoundException('Cotação não encontrada');
    }
    const requests = new Set<string>();
    for (const quote of quotes) {
      if (requests.has(quote.requestId)) {
        bad('Escolha uma cotação por solicitação');
      }
      requests.add(quote.requestId);
      if (
        quote.request.status !== 'REQUESTED' &&
        quote.request.status !== 'QUOTING'
      ) {
        bad(`A solicitação ${quote.request.number} não está em aberto`);
      }
    }
    const bySupplier = new Map<string, typeof quotes>();
    for (const quote of quotes) {
      const key =
        quote.supplierId ?? `nome:${quote.supplierName.toLowerCase()}`;
      bySupplier.set(key, [...(bySupplier.get(key) ?? []), quote]);
    }
    const ids = await this.prisma.$transaction(async (tx) => {
      // As solicitações saem do aberto aqui, antes do pedido: com dois
      // "Fechar o pedido" ao mesmo tempo, o segundo encontra a solicitação
      // já em pedido e é recusado (sem pedido em dobro)
      const claimed = await tx.purchaseRequest.updateMany({
        where: {
          id: { in: [...requests] },
          companyId,
          status: { in: ['REQUESTED', 'QUOTING'] },
        },
        data: { status: 'ORDERED' },
      });
      if (claimed.count !== requests.size) {
        throw new ConflictException(
          'Uma das solicitações já virou pedido ou foi cancelada: atualize a tela',
        );
      }
      await lockNumbering(tx, 'purchase_orders', companyId);
      const created: string[] = [];
      for (const group of bySupplier.values()) {
        const last = await tx.purchaseOrder.aggregate({
          where: { companyId },
          _max: { number: true },
        });
        const number = (last._max.number ?? 0) + 1;
        const total = group.reduce(
          (sum, quote) => sum + Math.round(quote.unitPrice * quote.quantity),
          0,
        );
        const order = await tx.purchaseOrder.create({
          data: {
            companyId,
            number,
            supplierId: group[0].supplierId,
            supplierName: group[0].supplierName,
            expectedAt: dateOf(dto.expectedAt),
            note: dto.note?.trim() || null,
            total,
            createdById: actor.id,
            createdByName: actor.name,
            events: {
              create: {
                companyId,
                text: `Pedido fechado das cotações (${group.length} item(ns))`,
                byName: actor.name,
              },
            },
          },
        });
        for (const quote of group) {
          const item = await tx.purchaseOrderItem.create({
            data: {
              orderId: order.id,
              requestId: quote.requestId,
              materialId: quote.request.materialId,
              variationId: quote.request.variationId,
              description: quote.request.description,
              unit: quote.request.unit,
              quantity: quote.quantity,
              unitPrice: quote.unitPrice,
            },
          });
          await tx.purchaseQuote.update({
            where: { id: quote.id },
            data: { chosen: true },
          });
          await tx.purchaseRequest.update({
            where: { id: quote.requestId },
            data: {
              status: 'ORDERED',
              orderItemId: item.id,
              events: {
                create: {
                  companyId,
                  text: `Virou o pedido de compra ${number} (${quote.supplierName})${dto.expectedAt ? `, entrega prevista para ${dto.expectedAt.split('-').reverse().join('/')}` : ''}`,
                  byName: actor.name,
                },
              },
            },
          });
        }
        created.push(order.id);
      }
      return created;
    });
    return Promise.all(ids.map((id) => this.order(companyId, id)));
  }

  /* ----------------------------------------------------------- pedido */

  private orderView(row: OrderRow) {
    return {
      id: row.id,
      number: row.number,
      supplierId: row.supplierId,
      supplierName: row.supplierName,
      status: row.status,
      expectedAt: day(row.expectedAt),
      deliveredAt: row.deliveredAt?.toISOString() ?? null,
      checkedAt: row.checkedAt?.toISOString() ?? null,
      checkedByName: row.checkedByName,
      invoiceId: row.invoiceId,
      payableId: row.payableId,
      total: row.total,
      note: row.note,
      cancelReason: row.cancelReason,
      createdByName: row.createdByName,
      createdAt: row.createdAt.toISOString(),
      items: row.items.map((item) => ({
        id: item.id,
        requestId: item.requestId,
        materialId: item.materialId,
        variationId: item.variationId,
        description: item.description,
        unit: item.unit,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        total: Math.round(item.unitPrice * item.quantity),
        receivedQuantity: item.receivedQuantity,
        divergence: item.divergence,
      })),
      events: row.events.map((event) => ({
        text: event.text,
        byName: event.byName,
        at: event.at.toISOString(),
      })),
    };
  }

  async orders(companyId: string, filter: PurchaseOrderFilterDto) {
    const search = filter.search?.trim();
    const rows = await this.prisma.purchaseOrder.findMany({
      where: {
        companyId,
        ...(filter.status && { status: filter.status }),
        ...(search && {
          OR: [
            { supplierName: { contains: search, mode: 'insensitive' } },
            {
              items: {
                some: {
                  description: { contains: search, mode: 'insensitive' },
                },
              },
            },
          ],
        }),
      },
      include: ORDER_INCLUDE,
      orderBy: { number: 'desc' },
      take: 300,
    });
    return rows.map((row) => this.orderView(row));
  }

  private async orderRow(companyId: string, id: string) {
    const row = await this.prisma.purchaseOrder.findFirst({
      where: { id, companyId },
      include: ORDER_INCLUDE,
    });
    if (!row) throw new NotFoundException(ORDER_NOT_FOUND);
    return row;
  }

  async order(companyId: string, id: string) {
    return this.orderView(await this.orderRow(companyId, id));
  }

  /** O pedido feito direto, sem solicitação. */
  async createOrder(
    companyId: string,
    dto: PurchaseOrderDto,
    actor: CashActor,
  ) {
    const supplier = await this.supplierName(
      companyId,
      dto.supplierId,
      dto.supplierName,
    );
    const items: Prisma.PurchaseOrderItemCreateWithoutOrderInput[] = [];
    for (const item of dto.items) {
      const material = await this.materialText(
        companyId,
        item.materialId,
        item.variationId,
      );
      const description = material?.description || item.description?.trim();
      if (!description) bad('Escolha o material ou descreva o item');
      items.push({
        materialId: item.materialId || null,
        variationId: item.materialId ? item.variationId || null : null,
        description: description!,
        unit: material?.unit ?? item.unit?.trim() ?? '',
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      });
    }
    const id = await this.prisma.$transaction(async (tx) => {
      await lockNumbering(tx, 'purchase_orders', companyId);
      const last = await tx.purchaseOrder.aggregate({
        where: { companyId },
        _max: { number: true },
      });
      const order = await tx.purchaseOrder.create({
        data: {
          companyId,
          number: (last._max.number ?? 0) + 1,
          ...supplier,
          expectedAt: dateOf(dto.expectedAt),
          note: dto.note?.trim() || null,
          total: items.reduce(
            (sum, item) => sum + Math.round(item.unitPrice * item.quantity),
            0,
          ),
          createdById: actor.id,
          createdByName: actor.name,
          items: { create: items },
          events: {
            create: {
              companyId,
              text: 'Pedido de compra feito',
              byName: actor.name,
            },
          },
        },
      });
      return order.id;
    });
    return this.order(companyId, id);
  }

  private async log(
    tx: Prisma.TransactionClient,
    companyId: string,
    order: OrderRow,
    text: string,
    actor: CashActor,
  ) {
    await tx.purchaseEvent.create({
      data: { companyId, orderId: order.id, text, byName: actor.name },
    });
    // A linha do tempo de quem pediu acompanha o pedido (ES-17)
    const requestIds = order.items
      .map((item) => item.requestId)
      .filter((id): id is string => !!id);
    for (const requestId of requestIds) {
      await tx.purchaseEvent.create({
        data: {
          companyId,
          requestId,
          text: `Pedido ${order.number}: ${text}`,
          byName: actor.name,
        },
      });
    }
  }

  /** Confirmar a entrega: chegou, falta conferir. */
  async deliver(companyId: string, id: string, actor: CashActor) {
    const row = await this.orderRow(companyId, id);
    if (row.status !== 'PENDING_DELIVERY') {
      bad('Só o pedido esperando a entrega pode ser confirmado');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.purchaseOrder.update({
        where: { id },
        data: { status: 'CHECKING', deliveredAt: new Date() },
      });
      await this.log(tx, companyId, row, 'Entrega recebida', actor);
    });
    return this.order(companyId, id);
  }

  /**
   * A conferência (ES-13): o que chegou de cada item e as diferenças; a
   * nota do fornecedor, quando houver, fica ligada ao pedido.
   */
  async check(
    companyId: string,
    id: string,
    dto: CheckOrderDto,
    actor: CashActor,
  ) {
    const row = await this.orderRow(companyId, id);
    if (row.status !== 'CHECKING') bad('Confirme a entrega antes de conferir');
    for (const entry of dto.items) {
      if (!row.items.some((item) => item.id === entry.itemId)) {
        throw new NotFoundException('Item do pedido não encontrado');
      }
    }
    if (dto.invoiceId) {
      const invoice = await this.prisma.inboundInvoice.findFirst({
        where: { id: dto.invoiceId, companyId },
        select: { id: true },
      });
      if (!invoice) throw new NotFoundException('Nota não encontrada');
      const other = await this.prisma.purchaseOrder.findFirst({
        where: { invoiceId: dto.invoiceId, id: { not: id }, companyId },
        select: { number: true },
      });
      if (other) bad(`Esta nota já está no pedido ${other.number}`);
    }
    const differences = dto.items.filter((entry) => {
      const item = row.items.find((current) => current.id === entry.itemId)!;
      return Math.abs(entry.receivedQuantity - item.quantity) > 1e-9;
    }).length;
    await this.prisma.$transaction(async (tx) => {
      for (const entry of dto.items) {
        await tx.purchaseOrderItem.update({
          where: { id: entry.itemId },
          data: {
            receivedQuantity: entry.receivedQuantity,
            divergence: entry.divergence?.trim() || null,
          },
        });
      }
      await tx.purchaseOrder.update({
        where: { id },
        data: {
          checkedAt: new Date(),
          checkedByName: actor.name,
          ...(dto.invoiceId !== undefined && { invoiceId: dto.invoiceId }),
        },
      });
      await this.log(
        tx,
        companyId,
        row,
        differences
          ? `Conferido, com ${differences} item(ns) diferente(s) do pedido`
          : 'Conferido: chegou o que foi pedido',
        actor,
      );
    });
    return this.order(companyId, id);
  }

  /**
   * Lançar no estoque: com a nota conferida, a entrada é a da nota (o custo
   * real, com os vínculos e fatores dela); sem nota, os itens com material
   * entram pelo que chegou e o preço do pedido. Os lotes de cada item nascem
   * aqui, com o custo na proporção.
   */
  async receive(
    companyId: string,
    id: string,
    dto: ReceiveOrderDto,
    actor: CashActor,
  ) {
    const row = await this.orderRow(companyId, id);
    if (row.status !== 'CHECKING' || !row.checkedAt) {
      bad('Confira a entrega antes de lançar no estoque');
    }
    for (const plan of dto.lots ?? []) {
      const item = row.items.find((current) => current.id === plan.itemId);
      if (!item) throw new NotFoundException('Item do pedido não encontrado');
      if (!item.materialId) bad(`"${item.description}" não tem material`);
      if (plan.measure !== 'UNIT' && !(plan.width && plan.length)) {
        bad(`Informe a largura e o comprimento de "${item.description}"`);
      }
    }
    if (row.invoiceId) {
      const invoice = await this.prisma.inboundInvoice.findUnique({
        where: { id: row.invoiceId },
        select: { status: true },
      });
      // A nota ainda não lançada entra agora, com a conciliação dela
      if (invoice && invoice.status !== 'ENTERED') {
        await this.stock.confirm(companyId, row.invoiceId, actor);
      }
    }
    const charges = await this.pricing.chargesOf(companyId);
    const origin = `Pedido de compra ${row.number} — ${row.supplierName}`;
    await this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.purchaseOrder.updateMany({
          where: { id, status: 'CHECKING' },
          data: { status: 'FINISHED' },
        });
        if (!claimed.count) {
          throw new ConflictException('O pedido já foi lançado no estoque');
        }
        if (dto.lots?.length) await lockNumbering(tx, 'stock_lots', companyId);
        let lotNumber =
          (
            await tx.stockLot.aggregate({
              where: { companyId },
              _max: { number: true },
            })
          )._max.number ?? 0;
        for (const item of row.items) {
          const received = item.receivedQuantity ?? item.quantity;
          if (!item.materialId || !(received > 0)) continue;
          const stock = row.invoiceId
            ? await tx.stockItem.upsert({
                where: {
                  companyId_key: {
                    companyId,
                    key: stockKey(item.materialId, item.variationId),
                  },
                },
                create: {
                  companyId,
                  key: stockKey(item.materialId, item.variationId),
                  materialId: item.materialId,
                  variationId: item.variationId,
                },
                update: {},
              })
            : await enterStock(tx, {
                companyId,
                materialId: item.materialId,
                variationId: item.variationId,
                quantity: received,
                entryCost: item.unitPrice,
                origin,
                date: new Date(),
                actor,
                charges,
              });
          const plan = dto.lots?.find((lot) => lot.itemId === item.id);
          if (!plan) continue;
          const each = received / plan.count;
          const cost = Math.round((item.unitPrice * received) / plan.count);
          for (let index = 0; index < plan.count; index++) {
            lotNumber += 1;
            await tx.stockLot.create({
              data: {
                companyId,
                stockItemId: stock.id,
                number: lotNumber,
                supplierName: row.supplierName,
                brand: plan.brand?.trim() ?? '',
                color: plan.color?.trim() ?? '',
                measure: plan.measure,
                cost,
                quantity: each,
                currentQuantity: each,
                width: plan.measure === 'UNIT' ? null : plan.width!,
                length: plan.measure === 'UNIT' ? null : plan.length!,
                currentWidth: plan.measure === 'UNIT' ? null : plan.width!,
                currentLength: plan.measure === 'UNIT' ? null : plan.length!,
                orderId: row.id,
                invoiceId: row.invoiceId,
                createdByName: actor.name,
                events: {
                  create: {
                    text: `Entrou pelo pedido de compra ${row.number}`,
                    quantity: each,
                    byName: actor.name,
                  },
                },
              },
            });
          }
        }
        await this.log(
          tx,
          companyId,
          row,
          row.invoiceId
            ? 'Lançado no estoque pela nota conferida'
            : 'Lançado no estoque',
          actor,
        );
        const requestIds = row.items
          .map((item) => item.requestId)
          .filter((value): value is string => !!value);
        if (requestIds.length) {
          await tx.purchaseRequest.updateMany({
            where: { id: { in: requestIds } },
            data: { status: 'RECEIVED' },
          });
        }
      },
      { timeout: 30000 },
    );
    return this.order(companyId, id);
  }

  async cancelOrder(
    companyId: string,
    id: string,
    reason: string,
    actor: CashActor,
  ) {
    const row = await this.orderRow(companyId, id);
    if (row.status === 'FINISHED') bad('O pedido já entrou no estoque');
    if (row.status === 'CANCELED') return this.orderView(row);
    const text = reason?.trim() || bad('Informe o motivo');
    await this.prisma.$transaction(async (tx) => {
      // Só cancela o pedido como foi lido: o lançamento no estoque ou as
      // contas a pagar gerados no meio tempo recusam o cancelamento
      const claimed = await tx.purchaseOrder.updateMany({
        where: {
          id,
          companyId,
          status: { in: ['PENDING_DELIVERY', 'CHECKING'] },
          payableId: row.payableId,
        },
        data: { status: 'CANCELED', cancelReason: text },
      });
      if (!claimed.count) {
        throw new ConflictException(
          'O pedido mudou enquanto era cancelado (entrou no estoque ou ganhou contas a pagar): atualize a tela e tente de novo',
        );
      }
      if (row.payableId) {
        await this.cancelPayable(tx, companyId, row, text, actor);
      }
      await this.log(
        tx,
        companyId,
        row,
        row.payableId
          ? `Cancelado, com as contas a pagar: ${text}`
          : `Cancelado: ${text}`,
        actor,
      );
      // As solicitações voltam a esperar a cotação
      const requestIds = row.items
        .map((item) => item.requestId)
        .filter((value): value is string => !!value);
      if (requestIds.length) {
        await tx.purchaseRequest.updateMany({
          where: { id: { in: requestIds } },
          data: { status: 'QUOTING', orderItemId: null },
        });
        await tx.purchaseQuote.updateMany({
          where: { requestId: { in: requestIds } },
          data: { chosen: false },
        });
      }
    });
    return this.order(companyId, id);
  }

  /**
   * O cancelamento do pedido leva as contas a pagar dele, como o Cancelar do
   * Financeiro: o título e as parcelas em aberto ficam CANCELED, com o
   * histórico. Com parcela paga (ou com pagamento), recusa: o pagamento se
   * desfaz no Financeiro antes.
   */
  private async cancelPayable(
    tx: Prisma.TransactionClient,
    companyId: string,
    order: OrderRow,
    reason: string,
    actor: CashActor,
  ) {
    const payable = await tx.payable.findFirst({
      where: { id: order.payableId!, companyId },
      select: {
        id: true,
        status: true,
        installments: {
          select: {
            id: true,
            installmentNumber: true,
            status: true,
            paidAmount: true,
            transactionId: true,
          },
          orderBy: { installmentNumber: 'asc' },
        },
      },
    });
    if (!payable || payable.status === 'CANCELED') return;
    const paid = payable.installments.filter(
      (installment) =>
        installment.status === 'PAID' ||
        installment.status === 'PROVISIONED' ||
        (installment.paidAmount ?? 0) > 0 ||
        !!installment.transactionId,
    );
    if (paid.length) {
      bad(
        `O pedido tem contas a pagar com parcela paga (${paid.map((installment) => installment.installmentNumber).join(', ')}): desfaça o pagamento no Financeiro antes de cancelar o pedido`,
      );
    }
    const open = payable.installments
      .filter((installment) => installment.status !== 'CANCELED')
      .map((installment) => installment.id);
    if (open.length) {
      const canceled = await tx.payableInstallment.updateMany({
        where: {
          id: { in: open },
          status: { in: ['PENDING', 'OVERDUE'] },
          OR: [{ paidAmount: null }, { paidAmount: { lte: 0 } }],
          transactionId: null,
        },
        data: { status: 'CANCELED' },
      });
      // Uma parcela paga no meio tempo desfaz tudo
      if (canceled.count !== open.length) {
        throw new ConflictException(
          'Uma parcela das contas a pagar do pedido foi paga agora: atualize a tela',
        );
      }
    }
    const cancelReason = `Pedido de compra ${order.number} cancelado: ${reason}`;
    await tx.payable.update({
      where: { id: payable.id },
      data: { status: 'CANCELED', cancelReason },
    });
    if (actor.id) {
      await tx.payableHistory.create({
        data: {
          payableId: payable.id,
          action: 'CANCEL',
          description: `Título cancelado: ${cancelReason}`,
          metadata: { cancelReason, purchaseOrderId: order.id },
          createdBy: actor.id,
          createdByName: actor.name,
        },
      });
    }
  }

  /**
   * A natureza e a subcategoria da compra de material: Operacional › Matéria
   * Prima, do plano de contas da empresa (natures-base), quando existem.
   */
  private async rawMaterialCategories(companyId: string) {
    const nature = await this.prisma.nature.findFirst({
      where: {
        companyId,
        isActive: true,
        description: { equals: 'Operacional', mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (!nature) return { natureId: null, subCategoryId: null };
    const subCategory = await this.prisma.subCategory.findFirst({
      where: {
        companyId,
        isActive: true,
        natureId: nature.id,
        OR: [
          { description: { equals: 'Matéria Prima', mode: 'insensitive' } },
          { description: { equals: 'Matéria-Prima', mode: 'insensitive' } },
          { description: { equals: 'Materia Prima', mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });
    return { natureId: nature.id, subCategoryId: subCategory?.id ?? null };
  }

  /**
   * As contas a pagar do pedido (ES-15): o total em parcelas, para o
   * fornecedor, em Operacional › Matéria Prima. Uma vez por pedido: a marca
   * no pedido é gravada na mesma transação, só se ainda não havia, e o
   * segundo pedido simultâneo desfaz o que criou.
   */
  async payables(
    companyId: string,
    id: string,
    dto: PayablesDto,
    actor: CashActor,
  ) {
    const row = await this.orderRow(companyId, id);
    if (row.status === 'CANCELED') bad('O pedido está cancelado');
    if (row.payableId) bad('As contas a pagar deste pedido já foram geradas');
    if (!(row.total > 0)) bad('O pedido não tem valor');
    let parts: ReturnType<typeof installmentsOf> = [];
    try {
      parts = installmentsOf(
        row.total,
        dto.installments,
        dto.firstDue,
        dto.everyDays ?? 30,
      );
    } catch (error) {
      bad((error as Error).message);
    }
    const [bankAccount, categories] = await Promise.all([
      this.prisma.bankAccount.findFirst({
        where: { companyId, isActive: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      }),
      this.rawMaterialCategories(companyId),
    ]);
    await this.prisma.$transaction(async (tx) => {
      const payable = await tx.payable.create({
        data: {
          referenceDate: new Date(),
          description: `Pedido de compra ${row.number} — ${row.supplierName}`,
          totalAmount: row.total,
          totalValue: row.total,
          mainAdditionalFee: 0,
          installmentQty: parts.length,
          status: 'PENDING',
          supplierId: row.supplierId,
          natureId: categories.natureId,
          subCategoryId: categories.subCategoryId,
          companyId,
        },
      });
      for (const part of parts) {
        await tx.payableInstallment.create({
          data: {
            payableId: payable.id,
            installmentNumber: part.number,
            dueDate: dateOf(part.dueDate)!,
            amount: part.amount,
            additionalFee: 0,
            paymentConditionId: null,
            bankAccountId: bankAccount?.id ?? null,
            status: 'PENDING',
            paidDate: null,
          },
        });
      }
      const claimed = await tx.purchaseOrder.updateMany({
        where: {
          id,
          companyId,
          payableId: null,
          status: { not: 'CANCELED' },
        },
        data: { payableId: payable.id },
      });
      if (!claimed.count) {
        throw new ConflictException(
          'As contas a pagar deste pedido já foram geradas (ou o pedido foi cancelado): atualize a tela',
        );
      }
      // O histórico do título, como o Financeiro grava ao criar
      if (actor.id) {
        await tx.payableHistory.create({
          data: {
            payableId: payable.id,
            action: 'CREATE',
            description: 'Título criado',
            metadata: {
              totalAmount: row.total,
              installmentQty: parts.length,
              supplierName: row.supplierName,
              expenseSource: 'SUPPLIER',
              purchaseOrderId: row.id,
            },
            createdBy: actor.id,
            createdByName: actor.name,
          },
        });
      }
      await this.log(
        tx,
        companyId,
        row,
        `Contas a pagar geradas em ${parts.length} parcela(s)`,
        actor,
      );
    });
    return this.order(companyId, id);
  }

  /** As notas do fornecedor que ainda não estão em pedido, para conferir. */
  async invoicesFor(companyId: string, id: string) {
    const row = await this.orderRow(companyId, id);
    const used = await this.prisma.purchaseOrder.findMany({
      where: { companyId, invoiceId: { not: null }, id: { not: id } },
      select: { invoiceId: true },
    });
    const invoices = await this.prisma.inboundInvoice.findMany({
      where: {
        companyId,
        id: { notIn: used.map((item) => item.invoiceId!) },
        ...(row.supplierId
          ? {
              OR: [
                { supplierId: row.supplierId },
                { supplierName: row.supplierName },
              ],
            }
          : {
              supplierName: { contains: row.supplierName, mode: 'insensitive' },
            }),
      },
      orderBy: { issueDate: 'desc' },
      take: 30,
      include: { items: { orderBy: { position: 'asc' } } },
    });
    return invoices.map((invoice) => ({
      id: invoice.id,
      number: invoice.number,
      issueDate: day(invoice.issueDate),
      total: invoice.total,
      status: invoice.status,
      items: invoice.items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unit: item.supplierUnit,
        unitValue: item.unitValue,
        materialId: item.materialId,
        variationId: item.variationId,
        conversionFactor: item.conversionFactor,
      })),
    }));
  }
}
