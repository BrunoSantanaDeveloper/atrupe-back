import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'nestjs-prisma';
import type { CashActor } from '../../financial/cash-control/cash-ledger';
import { UNIT_SYMBOL } from '../../material/material-text';
import { PricingParametersService } from '../../pricing/pricing-parameters.service';
import { enterStock, stockKey } from '../stock-entry';
import { LotCut, LotUse, splitLot, unitCostOf, useLot } from './lot-math';
import {
  LotSplitDto,
  LotUseDto,
  StockLotDto,
  StockLotFilterDto,
} from './purchasing.dto';

const bad = (message: string): never => {
  throw new BadRequestException(message);
};
const LOT_NOT_FOUND = 'Lote não encontrado';
const m = (value: number | null) =>
  value === null
    ? ''
    : value.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

const LOT_INCLUDE = {
  stockItem: {
    select: {
      materialId: true,
      variationId: true,
      material: { select: { name: true, unit: true } },
      variation: { select: { brand: true, color: true } },
    },
  },
  events: { orderBy: { at: 'desc' } },
} satisfies Prisma.StockLotInclude;

type LotRow = Prisma.StockLotGetPayload<{ include: typeof LOT_INCLUDE }>;

/**
 * O estoque por lote (ES-8 a ES-12; Maicol, 22/11/2026), como na primeira
 * versão: cada rolo ou chapa com o fornecedor, o custo, a marca, a cor e as
 * medidas; abrir, dar baixa (em metros ou pela sobra medida), dividir,
 * finalizar e cancelar com motivo.
 *
 * O saldo do estoque continua o mesmo: a entrada soma ao lançar o lote, e a
 * baixa da venda segue a composição (ES-7). A baixa no lote registra o que
 * saiu do rolo; ligar as duas é a pergunta do apontamento da impressão.
 */
@Injectable()
export class StockLotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingParametersService,
  ) {}

  private view(row: LotRow) {
    const material = row.stockItem.material;
    const variation = [
      row.stockItem.variation?.brand,
      row.stockItem.variation?.color,
    ]
      .filter(Boolean)
      .join(' · ');
    return {
      id: row.id,
      number: row.number,
      code: `L-${row.number}`,
      materialId: row.stockItem.materialId,
      variationId: row.stockItem.variationId,
      material: variation ? `${material.name} · ${variation}` : material.name,
      unit: UNIT_SYMBOL[material.unit] ?? '',
      supplierName: row.supplierName,
      brand: row.brand,
      color: row.color,
      measure: row.measure,
      cost: row.cost,
      unitCost: unitCostOf(row),
      quantity: row.quantity,
      width: row.width,
      length: row.length,
      currentQuantity: row.currentQuantity,
      currentWidth: row.currentWidth,
      currentLength: row.currentLength,
      // O valor do que sobrou, na proporção
      currentValue: Math.round(
        row.quantity > 0 ? (row.cost * row.currentQuantity) / row.quantity : 0,
      ),
      status: row.status,
      openedAt: row.openedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
      cancelReason: row.cancelReason,
      orderId: row.orderId,
      parentId: row.parentId,
      createdByName: row.createdByName,
      createdAt: row.createdAt.toISOString(),
      events: row.events.map((event) => ({
        text: event.text,
        quantity: event.quantity,
        byName: event.byName,
        at: event.at.toISOString(),
      })),
    };
  }

  async list(companyId: string, filter: StockLotFilterDto) {
    const search = filter.search?.trim();
    const view = filter.view ?? 'active';
    const rows = await this.prisma.stockLot.findMany({
      where: {
        companyId,
        ...(filter.status
          ? { status: filter.status }
          : view === 'active'
            ? { status: { in: ['CLOSED', 'OPEN'] } }
            : view === 'closed'
              ? { status: { in: ['FINISHED', 'CANCELED'] } }
              : {}),
        ...(search && {
          OR: [
            {
              stockItem: {
                material: { name: { contains: search, mode: 'insensitive' } },
              },
            },
            { supplierName: { contains: search, mode: 'insensitive' } },
            { color: { contains: search, mode: 'insensitive' } },
            { brand: { contains: search, mode: 'insensitive' } },
          ],
        }),
      },
      include: LOT_INCLUDE,
      orderBy: { number: 'desc' },
      take: 500,
    });
    return rows.map((row) => this.view(row));
  }

  private async row(companyId: string, id: string) {
    const row = await this.prisma.stockLot.findFirst({
      where: { id, companyId },
      include: LOT_INCLUDE,
    });
    if (!row) throw new NotFoundException(LOT_NOT_FOUND);
    return row;
  }

  async lot(companyId: string, id: string) {
    return this.view(await this.row(companyId, id));
  }

  /**
   * O lote lançado à mão: o rolo que já estava no estoque (sem mexer no
   * saldo) ou um novo que entra no saldo junto.
   */
  async create(companyId: string, dto: StockLotDto, actor: CashActor) {
    const material = await this.prisma.material.findFirst({
      where: { id: dto.materialId, companyId },
      select: { id: true },
    });
    if (!material) throw new NotFoundException('Material não encontrado');
    if (dto.variationId) {
      const variation = await this.prisma.materialVariation.findFirst({
        where: { id: dto.variationId, materialId: dto.materialId },
        select: { id: true },
      });
      if (!variation) throw new NotFoundException('Variação não encontrada');
    }
    if (dto.measure !== 'UNIT' && !(dto.width && dto.length)) {
      bad('Informe a largura e o comprimento');
    }
    const variationId = dto.variationId || null;
    const charges = dto.enterStock
      ? await this.pricing.chargesOf(companyId)
      : null;
    const id = await this.prisma.$transaction(async (tx) => {
      const key = stockKey(dto.materialId, variationId);
      const stock = charges
        ? await enterStock(tx, {
            companyId,
            materialId: dto.materialId,
            variationId,
            quantity: dto.quantity,
            entryCost: Math.round(dto.cost / dto.quantity),
            origin: 'Lote lançado à mão',
            date: new Date(),
            actor,
            charges,
          })
        : await tx.stockItem.upsert({
            where: { companyId_key: { companyId, key } },
            create: {
              companyId,
              key,
              materialId: dto.materialId,
              variationId,
            },
            update: {},
          });
      const last = await tx.stockLot.aggregate({
        where: { companyId },
        _max: { number: true },
      });
      const area = dto.measure === 'UNIT';
      const lot = await tx.stockLot.create({
        data: {
          companyId,
          stockItemId: stock.id,
          number: (last._max.number ?? 0) + 1,
          supplierName: dto.supplierName?.trim() ?? '',
          brand: dto.brand?.trim() ?? '',
          color: dto.color?.trim() ?? '',
          measure: dto.measure,
          cost: dto.cost,
          quantity: dto.quantity,
          currentQuantity: dto.quantity,
          width: area ? null : dto.width!,
          length: area ? null : dto.length!,
          currentWidth: area ? null : dto.width!,
          currentLength: area ? null : dto.length!,
          createdByName: actor.name,
          events: {
            create: {
              text: charges
                ? 'Lançado à mão, com entrada no saldo'
                : 'Lançado à mão (já estava no estoque)',
              quantity: dto.quantity,
              byName: actor.name,
            },
          },
        },
      });
      return lot.id;
    });
    return this.lot(companyId, id);
  }

  /** Abrir o lote: o rolo começa a ser consumido (ES-11). */
  async open(companyId: string, id: string, actor: CashActor) {
    const row = await this.row(companyId, id);
    if (row.status !== 'CLOSED') bad('Só o lote fechado pode ser aberto');
    await this.prisma.stockLot.update({
      where: { id },
      data: {
        status: 'OPEN',
        openedAt: new Date(),
        events: { create: { text: 'Aberto', byName: actor.name } },
      },
    });
    return this.lot(companyId, id);
  }

  /** A baixa no lote: em metros, pela sobra medida ou por quantidade. */
  async use(companyId: string, id: string, dto: LotUseDto, actor: CashActor) {
    const row = await this.row(companyId, id);
    if (row.status === 'FINISHED' || row.status === 'CANCELED') {
      bad('O lote está encerrado');
    }
    const use: LotUse | null =
      dto.remainingWidth !== undefined && dto.remainingLength !== undefined
        ? {
            width: dto.remainingWidth,
            length: dto.remainingLength,
            remaining: true,
          }
        : dto.length
          ? { length: dto.length }
          : dto.quantity
            ? { quantity: dto.quantity }
            : null;
    if (!use) bad('Informe o que saiu ou a sobra');
    let result: ReturnType<typeof useLot>;
    try {
      result = useLot(row, use!);
    } catch (error) {
      bad((error as Error).message);
    }
    const unit = UNIT_SYMBOL[row.stockItem.material.unit] ?? '';
    const finished = result!.currentQuantity <= 1e-6;
    const text =
      'remaining' in use!
        ? `Sobra medida: ${m(result!.currentWidth)} × ${m(result!.currentLength)} m`
        : 'length' in use!
          ? `Baixa de ${m(use.length)} m`
          : `Baixa de ${m(result!.used)} ${unit}`;
    await this.prisma.stockLot.update({
      where: { id },
      data: {
        currentQuantity: Math.max(result!.currentQuantity, 0),
        currentWidth: result!.currentWidth,
        currentLength: result!.currentLength,
        // A baixa abre o lote fechado; o que zera, finaliza
        ...(row.status === 'CLOSED' && {
          status: 'OPEN',
          openedAt: new Date(),
        }),
        ...(finished && { status: 'FINISHED', finishedAt: new Date() }),
        events: {
          create: {
            text: dto.note?.trim() ? `${text} — ${dto.note.trim()}` : text,
            quantity: result!.used,
            byName: actor.name,
          },
        },
      },
    });
    return this.lot(companyId, id);
  }

  /** Dividir o lote (ES-10): o pedaço vira um lote novo, rastreado. */
  async split(
    companyId: string,
    id: string,
    dto: LotSplitDto,
    actor: CashActor,
  ) {
    const row = await this.row(companyId, id);
    if (row.status === 'FINISHED' || row.status === 'CANCELED') {
      bad('O lote está encerrado');
    }
    const cut: LotCut | null = dto.length
      ? { length: dto.length }
      : dto.width
        ? { width: dto.width }
        : dto.quantity
          ? { quantity: dto.quantity }
          : null;
    if (!cut) bad('Informe o tamanho do pedaço');
    let result: ReturnType<typeof splitLot>;
    try {
      result = splitLot(row, cut!);
    } catch (error) {
      bad((error as Error).message);
    }
    const pieceId = await this.prisma.$transaction(async (tx) => {
      const last = await tx.stockLot.aggregate({
        where: { companyId },
        _max: { number: true },
      });
      const number = (last._max.number ?? 0) + 1;
      const piece = await tx.stockLot.create({
        data: {
          companyId,
          stockItemId: row.stockItemId,
          number,
          supplierName: row.supplierName,
          brand: row.brand,
          color: row.color,
          measure: row.measure,
          cost: result!.piece.cost,
          quantity: result!.piece.quantity,
          width: result!.piece.width,
          length: result!.piece.length,
          currentQuantity: result!.piece.quantity,
          currentWidth: result!.piece.width,
          currentLength: result!.piece.length,
          status: row.status,
          openedAt: row.openedAt,
          parentId: row.id,
          orderId: row.orderId,
          invoiceId: row.invoiceId,
          createdByName: actor.name,
          events: {
            create: {
              text: `Dividido do lote L-${row.number}`,
              quantity: result!.piece.quantity,
              byName: actor.name,
            },
          },
        },
      });
      // O lote de origem fica com o resto: a quantidade e o custo de entrada
      // diminuem na mesma proporção (o custo por unidade não muda), e o
      // comprimento de entrada acompanha, para a conta da área continuar
      const quantity = row.quantity - result!.piece.quantity;
      await tx.stockLot.update({
        where: { id },
        data: {
          ...result!.rest,
          quantity,
          cost: row.cost - result!.piece.cost,
          ...(row.length !== null && {
            length: (row.length * quantity) / row.quantity,
          }),
          events: {
            create: {
              text: `Dividido: o pedaço virou o lote L-${number}`,
              quantity: result!.piece.quantity,
              byName: actor.name,
            },
          },
        },
      });
      return piece.id;
    });
    return {
      lot: await this.lot(companyId, id),
      piece: await this.lot(companyId, pieceId),
    };
  }

  async finish(companyId: string, id: string, actor: CashActor) {
    const row = await this.row(companyId, id);
    if (row.status === 'FINISHED' || row.status === 'CANCELED') {
      bad('O lote já está encerrado');
    }
    await this.prisma.stockLot.update({
      where: { id },
      data: {
        status: 'FINISHED',
        finishedAt: new Date(),
        events: {
          create: {
            text:
              row.currentQuantity > 1e-6
                ? `Finalizado com sobra de ${m(row.currentQuantity)} ${UNIT_SYMBOL[row.stockItem.material.unit] ?? ''}`.trim()
                : 'Finalizado',
            byName: actor.name,
          },
        },
      },
    });
    return this.lot(companyId, id);
  }

  async cancel(
    companyId: string,
    id: string,
    reason: string,
    actor: CashActor,
  ) {
    const row = await this.row(companyId, id);
    if (row.status === 'CANCELED') return this.view(row);
    const text = reason?.trim() || bad('Informe o motivo');
    await this.prisma.stockLot.update({
      where: { id },
      data: {
        status: 'CANCELED',
        cancelReason: text,
        events: { create: { text: `Cancelado: ${text}`, byName: actor.name } },
      },
    });
    return this.lot(companyId, id);
  }
}
