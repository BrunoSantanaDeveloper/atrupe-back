import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { PAPER_SELECT } from '../material/paper';
import {
  PRINT_PRODUCT_SELECT,
  PrintSpec,
  bleedOf,
  printCounts,
  setupSheetsOf,
} from '../material/print-count';
import { PrintCountQueryDto, SavePrintSettingsDto } from './print.dto';

export const PRODUCT_NOT_FOUND = 'Produto não encontrado';
export const VARIATION_NOT_FOUND = 'Variação não encontrada';

/**
 * A impressão da gráfica rápida no LITE (12/11/2026): a sangria e as folhas
 * de acerto do produto, e a prévia da contagem de folhas para o item do
 * orçamento. Sem custo.
 */
@Injectable()
export class PrintService {
  constructor(private readonly prisma: PrismaService) {}

  private async productOf(companyId: string, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, companyId },
      select: {
        id: true,
        ...PRINT_PRODUCT_SELECT,
        items: { select: { width: true, height: true }, take: 1 },
        variations: {
          select: { id: true, paper: { select: PAPER_SELECT } },
        },
      },
    });
    if (!product) throw new NotFoundException(PRODUCT_NOT_FOUND);
    return product;
  }

  /** O que o produto define, o que herda do setor e o valor em uso. */
  async settings(companyId: string, id: string) {
    const product = await this.productOf(companyId, id);
    const bleed = bleedOf(null, product);
    return {
      bleedMm: product.bleedMm,
      setupSheets: product.setupSheets,
      sector: {
        bleedMm: product.sector?.bleedMm ?? null,
        setupSheets: product.sector?.setupSheets ?? null,
      },
      effective: {
        bleedMm: bleed.mm,
        bleedSource: bleed.source,
        setupSheets: setupSheetsOf(product),
      },
    };
  }

  async save(companyId: string, id: string, dto: SavePrintSettingsDto) {
    await this.productOf(companyId, id);
    await this.prisma.product.update({
      where: { id },
      data: {
        ...(dto.bleedMm !== undefined && { bleedMm: dto.bleedMm }),
        ...(dto.setupSheets !== undefined && {
          setupSheets: dto.setupSheets,
        }),
      },
    });
    return this.settings(companyId, id);
  }

  /**
   * A prévia da contagem no item, antes de gravar: a medida e a quantidade
   * da tela, a variação escolhida e a sangria que o vendedor mudou.
   */
  async preview(companyId: string, id: string, dto: PrintCountQueryDto) {
    const product = await this.productOf(companyId, id);
    const variation = dto.variationId
      ? product.variations.find((item) => item.id === dto.variationId)
      : product.variations.length === 1
        ? product.variations[0]
        : undefined;
    if (dto.variationId && !variation) {
      throw new NotFoundException(VARIATION_NOT_FOUND);
    }
    const spec = (dto.printSpec ?? null) as PrintSpec | null;
    const bleed = bleedOf(spec, product);
    const item = product.items[0];
    return {
      bleed: { mm: bleed.mm, source: bleed.source },
      setupSheets: setupSheetsOf(product),
      counts: printCounts({
        piece: {
          width: dto.width || item?.width || null,
          height: dto.height || item?.height || null,
        },
        pieces: dto.quantity,
        paper: variation?.paper ?? null,
        product,
        spec,
      }),
    };
  }
}
