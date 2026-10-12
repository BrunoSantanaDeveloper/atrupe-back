import { Injectable } from '@nestjs/common';
import { PricingCharges } from '../material/material-pricing';

/**
 * Os encargos da Precificação da empresa (tributação, custo financeiro e
 * comissão), em décimos de ponto.
 *
 * Quem os grava é o módulo 4 (`PUT /pricing/parameters`), que ainda não
 * existe: até lá valem zero para toda empresa, e o preço variável sai só de
 * custo e lucro. É o mesmo número que a tela usa hoje sem os dados de
 * demonstração. Quando o módulo 4 nascer, a leitura da tabela entra aqui e
 * quem consome não muda.
 */
@Injectable()
export class PricingParametersService {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async chargesOf(_companyId: string): Promise<PricingCharges> {
    return { taxation: 0, financialCost: 0, commission: 0 };
  }
}
