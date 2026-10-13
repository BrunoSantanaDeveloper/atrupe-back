import { Injectable } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { PricingCharges } from '../material/material-pricing';
import { PricingParams, ZERO_PARAMS, markupOf } from './pricing-math';

/**
 * Os parâmetros da Precificação da empresa (tributação, comissão, custo
 * financeiro e lucro desejado), em décimos de ponto, gravados por
 * `PUT /pricing/parameters`. Sem parâmetros gravados, tudo zero: o preço
 * variável sai só de custo e lucro, e o markup de referência é 1.
 */
@Injectable()
export class PricingParametersService {
  constructor(private readonly prisma: PrismaService) {}

  async parametersOf(companyId: string): Promise<PricingParams> {
    const row = await this.prisma.pricingParameters.findUnique({
      where: { companyId },
    });
    return row
      ? {
          taxation: row.taxation,
          commission: row.commission,
          financialCost: row.financialCost,
          desiredMargin: row.desiredMargin,
        }
      : { ...ZERO_PARAMS };
  }

  async chargesOf(companyId: string): Promise<PricingCharges> {
    const { taxation, financialCost, commission } =
      await this.parametersOf(companyId);
    return { taxation, financialCost, commission };
  }

  /**
   * O markup de referência (PR-1): multiplica o custo do recurso que não tem
   * preço de venda próprio (IP-25). Com encargos e lucro em 100 % ou mais,
   * não há markup que os pague: vale 1, e a tela da precificação avisa.
   */
  async referenceMarkupOf(companyId: string): Promise<number> {
    return markupOf(await this.parametersOf(companyId)) ?? 1;
  }
}
