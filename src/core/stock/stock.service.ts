import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StockMovementKind } from '@prisma/client';
import { PrismaService } from 'nestjs-prisma';
import { PricingParametersService } from '../pricing/pricing-parameters.service';
import { costChange } from '../material/material.service';
import { UNIT_SYMBOL, normalizeText } from '../material/material-text';
import { CashActor } from '../financial/cash-control/cash-ledger';
import { NfeXmlError, parseNfeXml } from './nfe-xml';
import {
  InvoiceEntryFilterDto,
  MatchInvoiceItemDto,
  StockFilterDto,
  StockMovementFilterDto,
} from './dto/stock.dto';

const bad = (message: string): never => {
  throw new BadRequestException(message);
};

const INVOICE_NOT_FOUND = 'Nota não encontrada';
const ITEM_NOT_FOUND = 'Item não encontrado';

const stockKey = (materialId: string, variationId: string | null) =>
  `${materialId}|${variationId ?? ''}`;

const day = (date: Date | null) =>
  date ? date.toISOString().slice(0, 10) : null;

const variationLabel = (
  variation: { brand: string; color: string } | null | undefined,
) =>
  variation
    ? [variation.brand, variation.color].filter(Boolean).join(' · ')
    : null;

/** O fornecedor do de-para: o documento, ou o nome sem acento e sem caixa. */
const supplierKeyOf = (invoice: {
  supplierDocument: string | null;
  supplierName: string;
}) => invoice.supplierDocument || normalizeText(invoice.supplierName);

const paged = <T>(rows: T[], page = 1, limit = 50) => {
  const size = Math.min(Math.max(limit, 1), 100);
  const total = rows.length;
  const lastPage = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(page, 1), lastPage);
  return {
    data: rows.slice((current - 1) * size, current * size),
    page: current,
    lastPage,
    total,
  };
};

const INVOICE_INCLUDE = {
  items: { orderBy: { position: 'asc' } },
} satisfies Prisma.InboundInvoiceInclude;

type InvoiceRow = Prisma.InboundInvoiceGetPayload<{
  include: typeof INVOICE_INCLUDE;
}>;

/**
 * Estoque e entrada de nota (ES-1 a ES-6, FULL): o saldo por material e
 * variação com o custo médio, os movimentos com a origem e a nota de
 * entrada, da conciliação com o de-para à entrada no estoque.
 */
@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingParametersService,
  ) {}

  /* ------------------------------------------------------------- saldo */

  async list(companyId: string, filter: StockFilterDto, values: boolean) {
    const search = filter.search?.trim();
    const rows = await this.prisma.stockItem.findMany({
      where: {
        companyId,
        ...(search
          ? {
              material: {
                OR: [
                  { name: { contains: search, mode: 'insensitive' } },
                  { code: { contains: search, mode: 'insensitive' } },
                ],
              },
            }
          : {}),
      },
      include: {
        material: { select: { name: true, unit: true } },
        variation: { select: { brand: true, color: true } },
      },
      orderBy: { material: { name: 'asc' } },
    });
    const filtered = rows.filter((row) =>
      filter.status === 'abaixo-do-minimo'
        ? row.quantity < row.minimum
        : filter.status === 'zerados'
          ? row.quantity === 0
          : true,
    );
    const page = paged(filtered, filter.page, filter.limit);
    return {
      ...page,
      data: page.data.map((row) => ({
        id: row.id,
        materialId: row.materialId,
        variationId: row.variationId,
        name: row.material.name,
        variation: variationLabel(row.variation),
        unit: UNIT_SYMBOL[row.material.unit],
        quantity: row.quantity,
        minimum: row.minimum,
        // Custo só com a permissão de valores
        ...(values
          ? { averageCost: row.averageCost, lastEntryCost: row.lastEntryCost }
          : {}),
        lastEntryDate: day(row.lastEntryDate),
      })),
    };
  }

  async movements(companyId: string, filter: StockMovementFilterDto) {
    const from = filter.from ? new Date(`${filter.from}T00:00:00`) : null;
    const to = filter.to ? new Date(`${filter.to}T23:59:59.999`) : null;
    const where: Prisma.StockMovementWhereInput = {
      companyId,
      ...(filter.kind ? { kind: filter.kind } : {}),
      ...(filter.materialId
        ? { stockItem: { materialId: filter.materialId } }
        : {}),
      ...(from || to
        ? {
            date: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    };
    const size = Math.min(Math.max(filter.limit ?? 50, 1), 100);
    const total = await this.prisma.stockMovement.count({ where });
    const lastPage = Math.max(1, Math.ceil(total / size));
    const page = Math.min(Math.max(filter.page ?? 1, 1), lastPage);
    const rows = await this.prisma.stockMovement.findMany({
      where,
      include: {
        stockItem: {
          include: {
            material: { select: { name: true, unit: true } },
            variation: { select: { brand: true, color: true } },
          },
        },
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * size,
      take: size,
    });
    return {
      data: rows.map((row) => ({
        id: row.id,
        date: day(row.date),
        kind: row.kind,
        name: [
          row.stockItem.material.name,
          variationLabel(row.stockItem.variation),
        ]
          .filter(Boolean)
          .join(' · '),
        quantity: row.quantity,
        unit: UNIT_SYMBOL[row.stockItem.material.unit],
        origin: row.origin,
      })),
      page,
      lastPage,
      total,
    };
  }

  private async stockItem(companyId: string, id: string) {
    const item = await this.prisma.stockItem.findFirst({
      where: { id, companyId },
      include: {
        material: { select: { name: true, unit: true } },
        variation: { select: { brand: true, color: true } },
      },
    });
    if (!item)
      throw new NotFoundException('Material não encontrado no estoque');
    return item;
  }

  /** O mínimo do material: abaixo dele, a aba "Abaixo do mínimo" avisa. */
  async setMinimum(companyId: string, id: string, minimum: number) {
    await this.stockItem(companyId, id);
    await this.prisma.stockItem.update({ where: { id }, data: { minimum } });
    return { id, minimum };
  }

  /**
   * O ajuste de inventário: a contagem física corrige o saldo, com motivo e
   * quem fez; o movimento é a diferença, e o custo médio não muda.
   */
  async adjust(
    companyId: string,
    id: string,
    counted: number,
    reason: string,
    actor: CashActor,
  ) {
    if (!reason?.trim()) bad('Informe o motivo do ajuste');
    const item = await this.stockItem(companyId, id);
    const difference = counted - item.quantity;
    if (!difference) bad('A contagem é igual ao saldo: não há o que ajustar');
    await this.prisma.$transaction([
      this.prisma.stockItem.update({
        where: { id },
        data: { quantity: counted },
      }),
      this.prisma.stockMovement.create({
        data: {
          companyId,
          stockItemId: id,
          kind: StockMovementKind.ADJUSTMENT,
          quantity: difference,
          unitCost: item.averageCost,
          origin: `Ajuste de inventário: ${reason.trim()}`,
          date: new Date(),
          createdById: actor.id,
          createdByName: actor.name,
        },
      }),
    ]);
    return { id, quantity: counted, difference };
  }

  /* ---------------------------------------------------- entrada de nota */

  /** O nome do material vinculado, do cadastro (ES-3). */
  private async materialNames(companyId: string, invoices: InvoiceRow[]) {
    const ids = [
      ...new Set(
        invoices.flatMap((invoice) =>
          invoice.items
            .map((item) => item.materialId)
            .filter((id): id is string => !!id),
        ),
      ),
    ];
    const materials = ids.length
      ? await this.prisma.material.findMany({
          where: { id: { in: ids }, companyId },
          select: {
            id: true,
            name: true,
            unit: true,
            variations: { select: { id: true, brand: true, color: true } },
          },
        })
      : [];
    return new Map(materials.map((material) => [material.id, material]));
  }

  private invoiceView(
    invoice: InvoiceRow,
    materials: Awaited<ReturnType<StockService['materialNames']>>,
  ) {
    return {
      id: invoice.id,
      number: invoice.number,
      series: invoice.series,
      accessKey: invoice.accessKey,
      supplierId: invoice.supplierId,
      supplier: invoice.supplierName,
      issueDate: day(invoice.issueDate),
      total: invoice.total,
      status: invoice.status,
      enteredAt: invoice.enteredAt?.toISOString() ?? null,
      enteredBy: invoice.enteredByName,
      items: invoice.items.map((item) => {
        const material = item.materialId
          ? materials.get(item.materialId)
          : null;
        const variation = material?.variations.find(
          (row) => row.id === item.variationId,
        );
        const entryQuantity =
          item.conversionFactor && material
            ? item.quantity * item.conversionFactor
            : null;
        return {
          id: item.id,
          supplierCode: item.supplierCode,
          description: item.description,
          supplierUnit: item.supplierUnit,
          quantity: item.quantity,
          unitValue: item.unitValue,
          gtin: item.gtin,
          materialId: material ? item.materialId : null,
          variationId: material ? item.variationId : null,
          materialName: material
            ? [material.name, variationLabel(variation)]
                .filter(Boolean)
                .join(' · ')
            : null,
          materialUnit: material ? UNIT_SYMBOL[material.unit] : null,
          conversionFactor: material ? item.conversionFactor : null,
          // O que entra no estoque e o custo por unidade do material
          entryQuantity,
          entryCost: entryQuantity
            ? Math.round((item.unitValue * item.quantity) / entryQuantity)
            : null,
        };
      }),
    };
  }

  async invoices(companyId: string, filter: InvoiceEntryFilterDto) {
    const search = filter.search?.trim();
    const where: Prisma.InboundInvoiceWhereInput = {
      companyId,
      // Sem filtro, as que aguardam entrada
      ...(filter.status === 'ALL'
        ? {}
        : filter.status
          ? { status: filter.status }
          : { status: { in: ['PENDING', 'MATCHED'] } }),
      ...(search
        ? {
            OR: [
              { number: { contains: search } },
              { supplierName: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const size = Math.min(Math.max(filter.limit ?? 20, 1), 100);
    const total = await this.prisma.inboundInvoice.count({ where });
    const lastPage = Math.max(1, Math.ceil(total / size));
    const page = Math.min(Math.max(filter.page ?? 1, 1), lastPage);
    const rows = await this.prisma.inboundInvoice.findMany({
      where,
      include: INVOICE_INCLUDE,
      orderBy: { issueDate: 'desc' },
      skip: (page - 1) * size,
      take: size,
    });
    const materials = await this.materialNames(companyId, rows);
    return {
      data: rows.map((row) => this.invoiceView(row, materials)),
      page,
      lastPage,
      total,
    };
  }

  private async invoice(companyId: string, id: string) {
    const invoice = await this.prisma.inboundInvoice.findFirst({
      where: { id, companyId },
      include: INVOICE_INCLUDE,
    });
    if (!invoice) throw new NotFoundException(INVOICE_NOT_FOUND);
    return invoice;
  }

  private async view(companyId: string, id: string) {
    const invoice = await this.invoice(companyId, id);
    return this.invoiceView(
      invoice,
      await this.materialNames(companyId, [invoice]),
    );
  }

  /**
   * Lança a nota pelo XML da NF-e: os itens chegam como o fornecedor mandou
   * e o de-para já reconhece o que foi vinculado antes (ES-3).
   */
  async importXml(companyId: string, xml: string) {
    let parsed: ReturnType<typeof parseNfeXml>;
    try {
      parsed = parseNfeXml(xml);
    } catch (error) {
      if (error instanceof NfeXmlError) bad(error.message);
      throw error;
    }
    if (parsed.accessKey) {
      const existing = await this.prisma.inboundInvoice.findFirst({
        where: { companyId, accessKey: parsed.accessKey },
        select: { id: true },
      });
      if (existing) throw new ConflictException('Esta nota já foi lançada');
    }
    const supplier = parsed.supplierDocument
      ? await this.prisma.supplier.findFirst({
          where: {
            companyId,
            OR: [
              { cnpj: { contains: parsed.supplierDocument } },
              { cpf: { contains: parsed.supplierDocument } },
            ],
          },
          select: { id: true, name: true },
        })
      : null;
    const supplierKey = supplierKeyOf(parsed);
    const links = await this.prisma.supplierItemLink.findMany({
      where: {
        companyId,
        supplierKey,
        supplierCode: { in: parsed.items.map((item) => item.supplierCode) },
        material: { active: true },
      },
    });
    const linkOf = new Map(links.map((link) => [link.supplierCode, link]));
    const items = parsed.items.map((item) => {
      const link = linkOf.get(item.supplierCode);
      return {
        ...item,
        materialId: link?.materialId ?? null,
        variationId: link?.variationId ?? null,
        conversionFactor: link?.conversionFactor ?? null,
      };
    });
    const created = await this.prisma.inboundInvoice.create({
      data: {
        companyId,
        number: parsed.number,
        series: parsed.series,
        accessKey: parsed.accessKey,
        supplierId: supplier?.id ?? null,
        supplierName: supplier?.name ?? parsed.supplierName,
        supplierDocument: parsed.supplierDocument,
        issueDate: parsed.issueDate,
        total: parsed.total,
        status: items.every((item) => item.materialId) ? 'MATCHED' : 'PENDING',
        items: { create: items },
      },
      select: { id: true },
    });
    return this.view(companyId, created.id);
  }

  /**
   * Concilia o item com o material e o fator (ES-3) e guarda o de-para do
   * fornecedor para as próximas notas.
   */
  async matchItem(
    companyId: string,
    invoiceId: string,
    itemId: string,
    dto: MatchInvoiceItemDto,
  ) {
    const invoice = await this.invoice(companyId, invoiceId);
    const item = invoice.items.find((row) => row.id === itemId);
    if (!item) throw new NotFoundException(ITEM_NOT_FOUND);
    if (invoice.status === 'ENTERED') {
      bad('Esta nota já deu entrada no estoque');
    }
    if (!(dto.conversionFactor > 0)) {
      bad('O fator de conversão precisa ser maior que zero');
    }
    const material = await this.prisma.material.findFirst({
      where: { id: dto.materialId, companyId, active: true },
      select: { id: true, variations: { select: { id: true } } },
    });
    if (!material) bad('Material não encontrado');
    const variationId = dto.variationId || null;
    if (
      variationId &&
      !material.variations.some((row) => row.id === variationId)
    ) {
      bad('Variação não encontrada');
    }
    const supplierKey = supplierKeyOf(invoice);
    await this.prisma.$transaction(async (tx) => {
      await tx.inboundInvoiceItem.update({
        where: { id: item.id },
        data: {
          materialId: material.id,
          variationId,
          conversionFactor: dto.conversionFactor,
        },
      });
      const pending = await tx.inboundInvoiceItem.count({
        where: { invoiceId: invoice.id, materialId: null },
      });
      await tx.inboundInvoice.update({
        where: { id: invoice.id },
        data: { status: pending ? 'PENDING' : 'MATCHED' },
      });
      if (item.supplierCode) {
        await tx.supplierItemLink.upsert({
          where: {
            companyId_supplierKey_supplierCode: {
              companyId,
              supplierKey,
              supplierCode: item.supplierCode,
            },
          },
          create: {
            companyId,
            supplierKey,
            supplierCode: item.supplierCode,
            materialId: material.id,
            variationId,
            conversionFactor: dto.conversionFactor,
          },
          update: {
            materialId: material.id,
            variationId,
            conversionFactor: dto.conversionFactor,
          },
        });
      }
    });
    const view = await this.view(companyId, invoice.id);
    return {
      ...view.items.find((row) => row.id === item.id),
      status: view.status,
    };
  }

  /**
   * Dá entrada da nota no estoque (ES-4, ES-5), uma vez só: por item, a
   * quantidade convertida soma no saldo, o custo médio é ponderado e passa
   * a ser o custo do material na composição.
   */
  async confirm(companyId: string, id: string, actor: CashActor) {
    const invoice = await this.invoice(companyId, id);
    if (invoice.status === 'ENTERED') {
      throw new ConflictException('Esta nota já deu entrada no estoque');
    }
    const pending = invoice.items.filter(
      (item) => !item.materialId || !item.conversionFactor,
    );
    if (pending.length) {
      bad(
        `${pending.length} item(ns) da nota ainda não foram vinculados a um material.`,
      );
    }
    const charges = await this.pricing.chargesOf(companyId);
    const origin = `NF ${invoice.number} — ${invoice.supplierName}`;
    const touched = new Set<string>();
    await this.prisma.$transaction(
      async (tx) => {
        // Só uma entrada passa: a segunda encontra a nota já lançada
        const claimed = await tx.inboundInvoice.updateMany({
          where: { id: invoice.id, status: { not: 'ENTERED' } },
          data: {
            status: 'ENTERED',
            enteredAt: new Date(),
            enteredById: actor.id,
            enteredByName: actor.name,
          },
        });
        if (!claimed.count) {
          throw new ConflictException('Esta nota já deu entrada no estoque');
        }
        for (const item of invoice.items) {
          const quantity = item.quantity * item.conversionFactor;
          if (!(quantity > 0)) continue;
          const entryCost = Math.round(
            (item.unitValue * item.quantity) / quantity,
          );
          const key = stockKey(item.materialId, item.variationId);
          const current = await tx.stockItem.findUnique({
            where: { companyId_key: { companyId, key } },
          });
          // Saldo negativo não pesa no custo médio
          const before = Math.max(0, current?.quantity ?? 0);
          const averageCost =
            before > 0
              ? Math.round(
                  (before * (current?.averageCost ?? 0) +
                    quantity * entryCost) /
                    (before + quantity),
                )
              : entryCost;
          const stock = await tx.stockItem.upsert({
            where: { companyId_key: { companyId, key } },
            create: {
              companyId,
              key,
              materialId: item.materialId,
              variationId: item.variationId,
              quantity,
              averageCost,
              lastEntryCost: entryCost,
              lastEntryDate: invoice.issueDate,
            },
            update: {
              quantity: { increment: quantity },
              averageCost,
              lastEntryCost: entryCost,
              lastEntryDate: invoice.issueDate,
            },
          });
          await tx.stockMovement.create({
            data: {
              companyId,
              stockItemId: stock.id,
              kind: StockMovementKind.ENTRY,
              quantity,
              unitCost: entryCost,
              origin,
              invoiceId: invoice.id,
              date: invoice.issueDate,
              createdById: actor.id,
              createdByName: actor.name,
            },
          });
          touched.add(stock.id);
          // O custo médio é o custo do material na composição (ES-5): no
          // preço variável o preço acompanha; no fixo, só a margem muda
          const material = await tx.material.findUnique({
            where: { id: item.materialId },
            select: {
              priceRule: true,
              cost: true,
              price: true,
              desiredMargin: true,
              _count: { select: { variations: true } },
            },
          });
          if (item.variationId) {
            const variation = await tx.materialVariation.findUnique({
              where: { id: item.variationId },
              select: { cost: true, price: true, desiredMargin: true },
            });
            if (material && variation) {
              const data = costChange(
                material.priceRule,
                variation,
                averageCost,
                charges,
              );
              if (Object.keys(data).length) {
                await tx.materialVariation.update({
                  where: { id: item.variationId },
                  data,
                });
              }
            }
          } else if (material && !material._count.variations) {
            const data = costChange(
              material.priceRule,
              material,
              averageCost,
              charges,
            );
            if (Object.keys(data).length) {
              await tx.material.update({
                where: { id: item.materialId },
                data,
              });
            }
          }
        }
      },
      { timeout: 20000 },
    );
    const stock = await this.prisma.stockItem.findMany({
      where: { id: { in: [...touched] } },
      select: {
        materialId: true,
        variationId: true,
        quantity: true,
        averageCost: true,
      },
    });
    return { ...(await this.view(companyId, invoice.id)), stock };
  }
}
