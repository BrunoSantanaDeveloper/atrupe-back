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
import { LotTask, soldMaterials } from './lot-task';
import { LotCut, LotUse, splitLot, unitCostOf, useLot } from './lot-math';
import {
  LotOpenDto,
  LotSplitDto,
  LotUseDto,
  TaskLotUseDto,
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
      material: { select: { name: true, unit: true, sectorId: true } },
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
      sectorId: row.sectorId,
      sectorName: row.sectorName,
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
        ...(filter.sectorId && { sectorId: filter.sectorId }),
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

  /**
   * Abrir o lote (ES-11): o rolo sai do estoque fechado e vai para um setor
   * (a impressão), onde fica disponível nas tarefas. Sem setor, o do
   * material.
   */
  async open(companyId: string, id: string, dto: LotOpenDto, actor: CashActor) {
    const row = await this.row(companyId, id);
    if (row.status !== 'CLOSED') bad('Só o lote fechado pode ser aberto');
    const sector = await this.sectorOf(companyId, row, dto.sectorId);
    await this.prisma.stockLot.update({
      where: { id },
      data: {
        status: 'OPEN',
        openedAt: new Date(),
        sectorId: sector?.id ?? null,
        sectorName: sector?.name ?? '',
        events: {
          create: {
            text: sector ? `Aberto no setor ${sector.name}` : 'Aberto',
            byName: actor.name,
          },
        },
      },
    });
    return this.lot(companyId, id);
  }

  /** Levar o lote aberto para outro setor. */
  async move(companyId: string, id: string, dto: LotOpenDto, actor: CashActor) {
    const row = await this.row(companyId, id);
    if (row.status !== 'OPEN') bad('Só o lote aberto muda de setor');
    const sector = await this.sectorOf(companyId, row, dto.sectorId);
    if (!sector) bad('Escolha o setor');
    await this.prisma.stockLot.update({
      where: { id },
      data: {
        sectorId: sector!.id,
        sectorName: sector!.name,
        events: {
          create: {
            text: `Levado para o setor ${sector!.name}`,
            byName: actor.name,
          },
        },
      },
    });
    return this.lot(companyId, id);
  }

  private async sectorOf(
    companyId: string,
    row: LotRow,
    sectorId?: string | null,
  ) {
    const id = sectorId || row.stockItem.material.sectorId;
    if (!id) return null;
    const sector = await this.prisma.companySector.findFirst({
      where: { id, companyId },
      select: { id: true, name: true },
    });
    if (sectorId && !sector)
      throw new NotFoundException('Setor não encontrado');
    return sector;
  }

  private parseUse(dto: {
    length?: number;
    quantity?: number;
    remainingWidth?: number;
    remainingLength?: number;
  }): LotUse {
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
    return use!;
  }

  /**
   * A baixa no lote, que vale para o estoque (ES-16; Maicol, 22/11/2026):
   * atualiza a sobra, registra no histórico do lote e tira do saldo pelo
   * custo do próprio lote. Pela tarefa é consumo da venda; à mão, correção.
   */
  private async applyUse(
    companyId: string,
    row: LotRow,
    use: LotUse,
    entry: {
      kind: 'CONSUMPTION' | 'ADJUSTMENT';
      origin: string;
      note?: string;
      quotationId?: string | null;
      taskId?: string | null;
      replacesKey?: string | null;
      prefix?: string;
    },
    actor: CashActor,
  ) {
    if (row.status === 'FINISHED' || row.status === 'CANCELED') {
      bad('O lote está encerrado');
    }
    let result: ReturnType<typeof useLot>;
    try {
      result = useLot(row, use);
    } catch (error) {
      bad((error as Error).message);
    }
    const unit = UNIT_SYMBOL[row.stockItem.material.unit] ?? '';
    const finished = result!.currentQuantity <= 1e-6;
    const base =
      'remaining' in use
        ? `Sobra medida: ${m(result!.currentWidth)} × ${m(result!.currentLength)} m`
        : 'length' in use
          ? `Baixa de ${m(use.length)} m (${m(result!.used)} ${unit})`
          : `Baixa de ${m(result!.used)} ${unit}`;
    const text = [entry.prefix, base, entry.note?.trim()]
      .filter(Boolean)
      .join(' — ');
    await this.prisma.$transaction(async (tx) => {
      await tx.stockLot.update({
        where: { id: row.id },
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
            create: { text, quantity: result!.used, byName: actor.name },
          },
        },
      });
      if (result!.used > 1e-9) {
        await tx.stockItem.update({
          where: { id: row.stockItemId },
          data: { quantity: { decrement: result!.used } },
        });
        await tx.stockMovement.create({
          data: {
            companyId,
            stockItemId: row.stockItemId,
            kind: entry.kind,
            quantity: -result!.used,
            unitCost: unitCostOf(row),
            origin: entry.origin,
            quotationId: entry.quotationId ?? null,
            lotId: row.id,
            taskId: entry.taskId ?? null,
            replacesKey: entry.replacesKey ?? null,
            date: new Date(),
            createdById: actor.id,
            createdByName: actor.name,
          },
        });
      }
    });
    return { used: result!.used, unit, text };
  }

  /** A baixa à mão, na tela de Lotes: corrige o saldo (a sobra medida). */
  async use(companyId: string, id: string, dto: LotUseDto, actor: CashActor) {
    const row = await this.row(companyId, id);
    await this.applyUse(
      companyId,
      row,
      this.parseUse(dto),
      {
        kind: 'ADJUSTMENT',
        origin: `Lote L-${row.number} — baixa à mão`,
        note: dto.note,
      },
      actor,
    );
    return this.lot(companyId, id);
  }

  /**
   * Os rolos para a tarefa da impressão: os lotes abertos no setor dela
   * (e os abertos sem setor), primeiro os do material vendido; o material
   * vendido da etapa; e as baixas já dadas na tarefa.
   */
  async forTask(companyId: string, task: LotTask) {
    const sold = soldMaterials(task.consumption);
    const soldKeys = new Set(sold.map((item) => item.key));
    const [rows, uses] = await Promise.all([
      this.prisma.stockLot.findMany({
        where: {
          companyId,
          status: 'OPEN',
          ...(task.sectorId && {
            OR: [{ sectorId: task.sectorId }, { sectorId: null }],
          }),
        },
        include: LOT_INCLUDE,
        orderBy: { number: 'asc' },
      }),
      this.prisma.stockMovement.findMany({
        where: { companyId, taskId: task.id, lotId: { not: null } },
        orderBy: { date: 'asc' },
        select: {
          quantity: true,
          origin: true,
          date: true,
          createdByName: true,
          lotId: true,
          replacesKey: true,
          stockItem: { select: { material: { select: { unit: true } } } },
        },
      }),
    ]);
    const lots = rows
      .map((row) => ({
        ...this.view(row),
        sold: soldKeys.has(
          stockKey(row.stockItem.materialId, row.stockItem.variationId),
        ),
      }))
      .sort((a, b) => Number(b.sold) - Number(a.sold));
    const lotNumber = new Map(
      (
        await this.prisma.stockLot.findMany({
          where: { id: { in: uses.map((use) => use.lotId!) } },
          select: { id: true, number: true },
        })
      ).map((lot) => [lot.id, lot.number]),
    );
    return {
      lots,
      sold,
      uses: uses.map((use) => ({
        lot: `L-${lotNumber.get(use.lotId!) ?? '?'}`,
        quantity: -use.quantity,
        unit: UNIT_SYMBOL[use.stockItem.material.unit] ?? '',
        replaces:
          sold.find((item) => item.key === use.replacesKey)?.name ?? null,
        byName: use.createdByName,
        at: use.date.toISOString(),
      })),
    };
  }

  /**
   * A baixa do impressor (ES-16): escolhe o rolo aberto e informa o
   * comprimento (a largura é a do rolo) ou a quantidade. Vale para o
   * estoque: a baixa da venda não tira de novo o material que ela
   * substitui. Material diferente do vendido fica como troca (VS-1.1).
   */
  async useForTask(
    companyId: string,
    task: LotTask,
    dto: TaskLotUseDto,
    actor: CashActor,
  ) {
    const row = await this.row(companyId, dto.lotId);
    if (row.status !== 'OPEN') bad('Abra o lote antes de dar baixa');
    const sold = soldMaterials(task.consumption);
    const lotKey = stockKey(
      row.stockItem.materialId,
      row.stockItem.variationId,
    );
    const replaces =
      dto.replaces !== undefined
        ? dto.replaces
        : sold.some((item) => item.key === lotKey) || !sold.length
          ? lotKey
          : null;
    if (
      replaces &&
      sold.length &&
      !sold.some((item) => item.key === replaces)
    ) {
      bad('O material substituído não é desta etapa');
    }
    const swapped = replaces && replaces !== lotKey;
    const replacedName = sold.find((item) => item.key === replaces)?.name;
    const result = await this.applyUse(
      companyId,
      row,
      dto.length
        ? { length: dto.length }
        : this.parseUse({ quantity: dto.quantity }),
      {
        kind: 'CONSUMPTION',
        origin: `OS ${task.number} · ${task.stageName} — lote L-${row.number}`,
        note: dto.note,
        quotationId: task.quotationId,
        taskId: task.id,
        replacesKey: replaces,
        prefix: `Tarefa ${task.code} (OS ${task.number})${swapped && replacedName ? `, no lugar de ${replacedName}` : ''}`,
      },
      actor,
    );
    const material = this.view(row).material;
    return {
      text: `Baixa no lote L-${row.number} (${material}): ${m(result.used)} ${result.unit}${dto.length ? ` (${m(dto.length)} m)` : ''}${swapped && replacedName ? `, no lugar de ${replacedName}` : ''}`,
    };
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
