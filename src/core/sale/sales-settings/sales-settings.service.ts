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
      select: { outsourcedMarkup: true },
    });
    return {
      outsourcedMarkup: row?.outsourcedMarkup ?? DEFAULT_OUTSOURCED_MARKUP,
    };
  }

  /** Vale para as próximas linhas; as já gravadas não mudam. */
  async update(companyId: string, dto: UpdateSalesSettingsDto) {
    const row = await this.prisma.saleSettings.upsert({
      where: { companyId },
      create: { companyId, outsourcedMarkup: dto.outsourcedMarkup },
      update: { outsourcedMarkup: dto.outsourcedMarkup },
      select: { outsourcedMarkup: true },
    });
    return { outsourcedMarkup: row.outsourcedMarkup };
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
