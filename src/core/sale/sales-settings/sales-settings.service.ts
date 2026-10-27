import { Injectable } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { UpdateSalesSettingsDto } from './dto/sales-settings.dto';

/** O markup do terceirizado avulso que vale sem configuração (o do legado). */
export const DEFAULT_OUTSOURCED_MARKUP = 45;

/**
 * Configurações de venda da empresa (MS-16, T-4). Por enquanto, o markup do
 * terceirizado avulso: o preço sugerido é custo ÷ (1 − markup/100).
 */
@Injectable()
export class SalesSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(companyId: string) {
    const row = await this.prisma.saleSettings.findUnique({
      where: { companyId },
      select: { outsourcedMarkup: true, minItemValue: true },
    });
    return {
      outsourcedMarkup: row?.outsourcedMarkup ?? DEFAULT_OUTSOURCED_MARKUP,
      // Venda mínima por item, em centavos (27/10/2026); 0 = sem mínimo
      minItemValue: row?.minItemValue ?? 0,
    };
  }

  /**
   * Vale para as próximas linhas; as já gravadas não mudam. Cada campo só
   * muda quando vem no corpo (27/10/2026).
   */
  async update(companyId: string, dto: UpdateSalesSettingsDto) {
    const row = await this.prisma.saleSettings.upsert({
      where: { companyId },
      create: {
        companyId,
        outsourcedMarkup: dto.outsourcedMarkup ?? DEFAULT_OUTSOURCED_MARKUP,
        minItemValue: dto.minItemValue ?? 0,
      },
      update: {
        ...(dto.outsourcedMarkup !== undefined && {
          outsourcedMarkup: dto.outsourcedMarkup,
        }),
        ...(dto.minItemValue !== undefined && {
          minItemValue: dto.minItemValue,
        }),
      },
      select: { outsourcedMarkup: true, minItemValue: true },
    });
    return {
      outsourcedMarkup: row.outsourcedMarkup,
      minItemValue: row.minItemValue,
    };
  }

  async outsourcedMarkupOf(companyId: string) {
    return (await this.get(companyId)).outsourcedMarkup;
  }
}

/**
 * O preço sugerido do terceirizado avulso, em centavos: custo + acréscimo
 * sobre o custo (T-5, 24/10/2026). R$ 200 com 45 % → R$ 290. Antes era
 * custo ÷ (1 − %), que é margem sobre o preço, não o que o produto quer.
 */
export const outsourcedPrice = (cost: number, markup: number) =>
  Math.round(cost * (1 + markup / 100));
