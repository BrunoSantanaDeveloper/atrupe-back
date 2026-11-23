import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { ProductionCleanupService } from './production-cleanup.service';
import { ProductionFilesService } from './production-files.service';
import { ProductionStorageService } from './production-storage.service';

const TOP = 10;

/**
 * A tela de armazenamento da empresa (GP-49; Maicol, 22/11/2026: "bem
 * parecido com o iCloud"), em todos os planos: o espaço usado e a faixa, o
 * que ocupa (arquivos de produção e arquivos das O.S.), as O.S. que mais
 * ocupam, o que a limpeza pode liberar e a própria limpeza.
 */
@Injectable()
export class CompanyStorageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: ProductionFilesService,
    private readonly storage: ProductionStorageService,
    private readonly cleanup: ProductionCleanupService,
  ) {}

  async overview(companyId: string) {
    const [summary, versions, orderFiles, eligible, history, auto] =
      await Promise.all([
        this.files.summary(companyId, this.storage.configured()),
        this.prisma.productionAttachmentVersion.findMany({
          where: { removedAt: null, attachment: { task: { companyId } } },
          select: {
            size: true,
            attachment: {
              select: {
                task: {
                  select: { project: { select: { quotationId: true } } },
                },
              },
            },
          },
        }),
        this.prisma.orderFile.findMany({
          where: { removedAt: null, companyId },
          select: { size: true, order: { select: { quotationId: true } } },
        }),
        this.cleanup.preview(companyId, 100),
        this.cleanup.history(companyId),
        this.cleanup.auto(companyId),
      ]);

    const bySale = new Map<string, { production: number; orders: number }>();
    const add = (id: string, kind: 'production' | 'orders', size: number) => {
      const row = bySale.get(id) ?? { production: 0, orders: 0 };
      row[kind] += size;
      bySale.set(id, row);
    };
    let production = 0;
    let orders = 0;
    for (const row of versions) {
      production += row.size;
      add(row.attachment.task.project.quotationId, 'production', row.size);
    }
    for (const row of orderFiles) {
      orders += row.size;
      add(row.order.quotationId, 'orders', row.size);
    }

    const top = [...bySale.entries()]
      .map(([id, row]) => ({ id, ...row, bytes: row.production + row.orders }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, TOP);
    const sales = top.length
      ? await this.prisma.quotation.findMany({
          where: { id: { in: top.map((row) => row.id) }, companyId },
          select: {
            id: true,
            quotationNumber: true,
            series: { select: { code: true } },
            client: { select: { name: true } },
            order: { select: { id: true, status: true } },
          },
        })
      : [];
    const saleOf = new Map(sales.map((sale) => [sale.id, sale]));

    return {
      storage: summary,
      byKind: { production, orders },
      // O que a limpeza pode apagar: as O.S. entregues (finalizadas)
      cleanableBytes: eligible.eligibleBytes,
      largest: top.map((row) => {
        const sale = saleOf.get(row.id);
        const number = sale?.quotationNumber ?? '';
        return {
          quotationId: row.id,
          orderId: sale?.order?.id ?? null,
          number: sale?.series?.code
            ? `${number}-${sale.series.code}`
            : String(number),
          client: sale?.client?.name ?? '',
          status: sale?.order?.status ?? null,
          production: row.production,
          orders: row.orders,
          bytes: row.bytes,
        };
      }),
      history,
      auto,
    };
  }
}
