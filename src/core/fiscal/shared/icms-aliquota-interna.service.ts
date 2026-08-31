import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';

import {
  PADRAO_ALIQUOTA_INTERNA,
  UFS,
  isUfValida,
  normalizarUf,
} from '../utils/icms-aliquota-interna.util';

/** Chave única em system_settings; o valor é um mapa { UF: alíquota }. */
const CHAVE = 'icms_aliquotas_internas';

export type OrigemAliquota = 'padrao' | 'ajustado';

export interface AliquotaInternaResolvida {
  uf: string;
  aliquota: number;
  origem: OrigemAliquota;
  /** Só para origem "padrao": indica se o valor foi conferido em fonte oficial. */
  revisado: boolean;
}

/**
 * Alíquota interna do ICMS por UF, com ajuste do superadmin sobre os padrões.
 *
 * Os padrões evitam exigir o cadastro das 27 UFs antes do primeiro uso, mas
 * parte deles não foi conferida na legislação estadual — por isso o retorno
 * carrega `origem` e `revisado`, para a tela mostrar o que ainda precisa de
 * validação em vez de dar a impressão de que tudo está aferido.
 */
@Injectable()
export class IcmsAliquotaInternaService {
  private readonly logger = new Logger(IcmsAliquotaInternaService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async ajustes(): Promise<Record<string, number>> {
    const registro = await this.prisma.systemSetting.findUnique({
      where: { key: CHAVE },
    });
    const valor = registro?.value;
    if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return {};

    const saida: Record<string, number> = {};
    for (const [uf, aliquota] of Object.entries(
      valor as Record<string, unknown>,
    )) {
      const sigla = normalizarUf(uf);
      if (isUfValida(sigla) && typeof aliquota === 'number') {
        saida[sigla] = aliquota;
      }
    }
    return saida;
  }

  /** Todas as UFs, com o valor efetivo e a procedência dele. */
  async listar(): Promise<AliquotaInternaResolvida[]> {
    const ajustes = await this.ajustes();
    return UFS.map((uf) => {
      const padrao = PADRAO_ALIQUOTA_INTERNA[uf];
      const ajustado = ajustes[uf];
      return ajustado !== undefined
        ? {
            uf,
            aliquota: ajustado,
            origem: 'ajustado' as const,
            revisado: true,
          }
        : {
            uf,
            aliquota: padrao.aliquota,
            origem: 'padrao' as const,
            revisado: padrao.revisado,
          };
    });
  }

  /**
   * Alíquota efetiva da UF. Devolve `null` para UF desconhecida — quem calcula
   * imposto precisa tratar isso, e não receber um número plausível e errado.
   */
  async resolver(uf?: string | null): Promise<number | null> {
    const sigla = normalizarUf(uf);
    if (!isUfValida(sigla)) return null;

    const ajustes = await this.ajustes();
    if (ajustes[sigla] !== undefined) return ajustes[sigla];

    const padrao = PADRAO_ALIQUOTA_INTERNA[sigla];
    if (!padrao.revisado) {
      this.logger.warn(
        `Alíquota interna de ${sigla} usando padrão não conferido (${padrao.aliquota}%). Ajuste em Configurações do sistema.`,
      );
    }
    return padrao.aliquota;
  }

  /**
   * Grava os ajustes. Enviar `null` para uma UF remove o ajuste e devolve o
   * padrão — é como se desfaz uma alteração, sem precisar saber o valor antigo.
   */
  async atualizar(
    entradas: Record<string, number | null>,
  ): Promise<AliquotaInternaResolvida[]> {
    const atuais = await this.ajustes();

    for (const [uf, aliquota] of Object.entries(entradas)) {
      const sigla = normalizarUf(uf);
      if (!isUfValida(sigla)) {
        throw new BadRequestException(`UF inválida: ${uf}`);
      }
      if (aliquota === null) {
        delete atuais[sigla];
        continue;
      }
      if (typeof aliquota !== 'number' || aliquota < 0 || aliquota > 100) {
        throw new BadRequestException(
          `Alíquota inválida para ${sigla}: informe um percentual entre 0 e 100.`,
        );
      }
      atuais[sigla] = aliquota;
    }

    await this.prisma.systemSetting.upsert({
      where: { key: CHAVE },
      create: { key: CHAVE, value: atuais },
      update: { value: atuais },
    });

    return this.listar();
  }
}
