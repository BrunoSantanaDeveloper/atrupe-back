import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import * as jspdf from 'jspdf';
import { PricingParametersService } from '../../pricing/pricing-parameters.service';

/** Um recurso do retrato (ORC-10): estimado e, depois, realizado (ORC-9). */
type ResultResource = {
  kind: string;
  name: string;
  unit: string;
  quantity: number;
  unitCost: number | null;
  cost: number;
  // A venda sugerida do recurso no retrato; nulo onde o retrato não guarda
  // (a lista informada pelo vendedor). A tela reparte o preço do item por
  // ela, como a Estimativa de Custos do legado (20/11/2026)
  sale: number | null;
  actualQuantity: number | null;
  actualCost: number | null;
};

type ResultLine = {
  id: string;
  kind: string;
  name: string;
  sector: string;
  price: number | null;
  cost: number;
  resolvedAt: string | null;
  resolved: ResultResource[];
};

const QUOTATION_NOT_FOUND = 'Orçamento não encontrado';

// Margem em percentual com uma casa (38,0 = 38,0 %)
const marginOf = (result: number, revenue: number) =>
  revenue > 0 ? Math.round((result / revenue) * 1000) / 10 : 0;

type Raw = Record<string, unknown>;
const num = (value: unknown) => (typeof value === 'number' ? value : 0);
const numOrNull = (value: unknown) =>
  typeof value === 'number' ? value : null;
const text = (value: unknown) => (typeof value === 'string' ? value : '');

/**
 * Os recursos de um retrato, qualquer que seja a origem: as etapas da
 * composição do item (com as linhas dentro), as linhas resolvidas de um
 * processo, ou a parte (as etapas do produto). Na lista, cada item informado
 * é um recurso.
 */
const resourcesOf = (resolved: unknown): ResultResource[] => {
  if (!Array.isArray(resolved)) return [];
  return (resolved as Raw[]).flatMap((entry) => {
    if (Array.isArray(entry.lines)) return resourcesOf(entry.lines);
    if (Array.isArray(entry.entries) && entry.entries.length) {
      return (entry.entries as Raw[]).map((item) => ({
        kind: text(entry.kind),
        name: text(item.name),
        unit: text(item.unit),
        quantity: num(item.quantity),
        unitCost: numOrNull(item.unitCost),
        cost: num(item.cost),
        sale: numOrNull(item.sale),
        actualQuantity: null,
        actualCost: null,
      }));
    }
    return [
      {
        kind: text(entry.kind),
        name: text(entry.resource) || text(entry.name),
        unit: text(entry.unit),
        quantity: num(entry.quantity),
        unitCost: numOrNull(entry.unitCost),
        cost: num(entry.cost),
        sale: numOrNull(entry.sale),
        actualQuantity: numOrNull(entry.actualQuantity),
        actualCost: numOrNull(entry.actualCost),
      },
    ];
  });
};

const brl = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });

/**
 * O resultado previsto da venda (ORC-8): receita, custo de produção pelo
 * retrato gravado (ORC-10, sem refazer a conta com o custo de hoje),
 * comissão do perfil do vendedor e tributos da Precificação. É uma tela de
 * método: rota com permissão própria, desligada no perfil de vendedor.
 */
@Injectable()
export class QuotationResultService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingParametersService,
  ) {}

  async result(quotationId: string) {
    const quotation = await this.prisma.quotation.findUnique({
      where: { id: quotationId },
      select: {
        companyId: true,
        totalValue: true,
        quotationNumber: true,
        status: true,
        createdAt: true,
        approvedAt: true,
        series: { select: { code: true } },
        client: { select: { name: true } },
        seller: {
          select: {
            name: true,
            sellerProfile: { select: { commission: true } },
          },
        },
        quotationPayment: { select: { finalValue: true } },
        quotationProduct: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            description: true,
            finalValue: true,
            product: { select: { name: true } },
            snapshot: { select: { data: true, computedAt: true } },
            lines: {
              orderBy: { createdAt: 'asc' },
              select: {
                id: true,
                kind: true,
                name: true,
                sector: true,
                price: true,
                cost: true,
                resolved: true,
                resolvedAt: true,
              },
            },
          },
        },
      },
    });
    if (!quotation) throw new NotFoundException(QUOTATION_NOT_FOUND);

    const items = quotation.quotationProduct.map((item) => {
      const snapshot = (item.snapshot?.data ?? null) as Raw | null;
      // As etapas da composição do item, como linhas sem preço próprio: o
      // preço é o do item
      const stages: ResultLine[] = Array.isArray(snapshot?.stages)
        ? (snapshot!.stages as Raw[]).map((stage) => ({
            id: text(stage.blockId),
            kind: 'STAGE',
            name: text(stage.name),
            sector: text(stage.sector),
            price: null,
            cost: num(stage.cost),
            resolvedAt: item.snapshot!.computedAt.toISOString(),
            resolved: resourcesOf(stage.lines),
          }))
        : [];
      const added: ResultLine[] = item.lines.map((line) => ({
        id: line.id,
        kind: line.kind,
        name: line.name,
        sector: line.sector,
        price: line.price,
        cost: line.cost,
        resolvedAt: line.resolvedAt.toISOString(),
        // O terceirizado não tem retrato: o custo digitado é o recurso
        resolved:
          line.kind === 'LOOSE'
            ? [
                {
                  kind: 'OUTSOURCED',
                  name: line.name,
                  unit: 'un',
                  quantity: 1,
                  unitCost: line.cost,
                  cost: line.cost,
                  sale: line.price,
                  actualQuantity: null,
                  actualCost: null,
                },
              ]
            : resourcesOf(line.resolved),
      }));
      const total = item.finalValue ?? 0;
      const cost = [...stages, ...added].reduce(
        (sum, line) => sum + line.cost,
        0,
      );
      return {
        itemId: item.id,
        name: item.description || item.product?.name || '',
        total,
        cost,
        margin: marginOf(total - cost, total),
        // Item sem retrato nem linha: o custo dele não é conhecido
        costKnown: !!snapshot || added.length > 0,
        lines: [...stages, ...added],
      };
    });

    const revenue =
      quotation.quotationPayment?.finalValue ??
      quotation.totalValue ??
      items.reduce((sum, item) => sum + item.total, 0);
    const productionCost = items.reduce((sum, item) => sum + item.cost, 0);
    const commissionPercent = quotation.seller?.sellerProfile?.commission ?? 0;
    const charges = await this.pricing.chargesOf(quotation.companyId);
    // A tributação da Precificação vem em décimos de ponto
    const taxesPercent = charges.taxation / 10;
    const commission = Math.round((revenue * commissionPercent) / 100);
    const taxes = Math.round((revenue * taxesPercent) / 100);
    const result = revenue - productionCost - commission - taxes;

    return {
      // A venda ("3352-V1") e o cliente, para o topo da tela
      reference: [quotation.quotationNumber, quotation.series?.code]
        .filter((part) => part !== null && part !== undefined && part !== '')
        .join('-'),
      client: quotation.client?.name ?? null,
      // O cabeçalho da Estimativa de Custos do legado (20/11/2026)
      seller: quotation.seller?.name ?? null,
      status: quotation.status,
      createdAt: quotation.createdAt.toISOString(),
      approvedAt: quotation.approvedAt?.toISOString() ?? null,
      revenue,
      productionCost,
      commission: { percent: commissionPercent, value: commission },
      taxes: { percent: taxesPercent, value: taxes },
      result,
      margin: marginOf(result, revenue),
      items,
    };
  }

  /**
   * O resultado em PDF, com empresa, usuário e data em todas as páginas
   * (SEG-3): o arquivo que sai identifica quem tirou.
   */
  async exportPdf(
    quotationId: string,
    who: { userName: string; at: Date },
  ): Promise<{ file: Buffer; name: string }> {
    const data = await this.result(quotationId);
    const header = await this.prisma.quotation.findUnique({
      where: { id: quotationId },
      select: {
        quotationNumber: true,
        series: { select: { code: true } },
        company: { select: { name: true } },
        client: { select: { name: true } },
      },
    });
    const sale = [header?.quotationNumber, header?.series?.code]
      .filter((part) => part !== null && part !== undefined && part !== '')
      .join('-');
    const stamp = `${header?.company?.name ?? ''} · ${who.userName} · ${who.at.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;

    const doc = new jspdf.jsPDF('p', 'pt', 'a4');
    const width = doc.internal.pageSize.getWidth();
    const height = doc.internal.pageSize.getHeight();
    const left = 40;
    let y = 70;

    const ensure = (space: number) => {
      if (y + space > height - 50) {
        doc.addPage();
        y = 70;
      }
    };
    const row = (label: string, value: string, bold = false) => {
      ensure(16);
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.text(label, left, y);
      doc.text(value, width - left, y, { align: 'right' });
      y += 16;
    };

    doc.setFontSize(14).setFont('helvetica', 'bold');
    doc.text(`Resultado previsto · venda ${sale}`, left, y);
    y += 18;
    doc.setFontSize(10).setFont('helvetica', 'normal');
    if (header?.client?.name) {
      doc.text(`Cliente: ${header.client.name}`, left, y);
      y += 20;
    }

    row('Receita', brl(data.revenue), true);
    row('Custo de produção', brl(data.productionCost));
    row(`Comissão (${data.commission.percent} %)`, brl(data.commission.value));
    row(`Tributos (${data.taxes.percent} %)`, brl(data.taxes.value));
    row('Resultado', brl(data.result), true);
    row('Margem', `${data.margin.toLocaleString('pt-BR')} %`);
    y += 10;

    for (const item of data.items) {
      ensure(40);
      doc.setFont('helvetica', 'bold');
      doc.text(item.name, left, y);
      doc.text(
        `${brl(item.total)} · custo ${brl(item.cost)} · margem ${item.margin.toLocaleString('pt-BR')} %`,
        width - left,
        y,
        { align: 'right' },
      );
      y += 16;
      doc.setFont('helvetica', 'normal');
      for (const line of item.lines) {
        ensure(14);
        doc.text(`${line.name} · ${line.sector}`, left + 12, y);
        doc.text(brl(line.cost), width - left, y, { align: 'right' });
        y += 14;
        for (const resource of line.resolved) {
          ensure(12);
          doc.setFontSize(8);
          doc.text(
            `${resource.name} · ${resource.quantity.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${resource.unit}`,
            left + 24,
            y,
          );
          doc.text(brl(resource.cost), width - left, y, { align: 'right' });
          doc.setFontSize(10);
          y += 12;
        }
      }
      y += 8;
    }

    // Empresa, usuário e data em todas as páginas (SEG-3)
    const pages = doc.getNumberOfPages();
    for (let page = 1; page <= pages; page++) {
      doc.setPage(page);
      doc.setFontSize(8).setFont('helvetica', 'normal');
      doc.text(stamp, left, 30);
      doc.text(`Página ${page} de ${pages}`, width - left, height - 25, {
        align: 'right',
      });
      doc.text('Documento interno: custo e margem da venda', left, height - 25);
    }

    return {
      file: Buffer.from(doc.output('arraybuffer')),
      name: `resultado-venda-${sale || quotationId}.pdf`,
    };
  }
}
