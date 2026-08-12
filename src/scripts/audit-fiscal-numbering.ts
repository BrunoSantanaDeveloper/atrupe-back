#!/usr/bin/env node
/**
 * Auditoria (e correção) da numeração fiscal por (emissor, ambiente, docType).
 *
 * POR QUE ESTE SCRIPT EXISTE
 * A migration 20260803120000 moveu a numeração de NF-e/NFS-e para
 * `invoicy_environment_configs`. Ela copiou a sequência legada apenas para o
 * ambiente ATIVO de cada docType e semeou o OUTRO ambiente com 1. Emissor que
 * já emitia em produção mas estava com `activeEnvironmentNfe` nulo ou em
 * homologação ficou com a sequência de produção zerada — a emissão seguinte
 * repetiu um número já autorizado e a SEFAZ devolveu a rejeição 539
 * ("Duplicidade de NF-e, com diferença na Chave de Acesso").
 *
 * A própria migration pedia esta conferência ("valide comparando max(numero)
 * por (serie, ambiente) contra o nextNumber migrado"); aqui ela está
 * automatizada.
 *
 * O QUE ELE FAZ
 * Para cada emissor × ambiente × docType, compara o `nextNumber` gravado com o
 * maior número que o próprio sistema já mandou para a autorizadora naquela
 * série/ambiente. Se o contador for menor ou igual ao já usado, a próxima
 * emissão duplica.
 *
 * LIMITE IMPORTANTE
 * Só enxerga documentos que estão neste banco. Notas emitidas antes da migração
 * para o Atrupe (ou em outro sistema) não aparecem — nesses casos o número
 * correto vem do cliente e deve ser ajustado na tela de Emissor, escolhendo o
 * ambiente certo.
 *
 * USO
 *   npm run fiscal:numbering:audit         # relatório, não escreve nada
 *   npm run fiscal:numbering:audit -- --fix
 *   ... -- --company=<companyId>  |  --emissor=<invoicyConfigId>
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import {
  NfceStatus,
  NfeStatus,
  NfseStatus,
  PrismaClient,
} from '@prisma/client';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const APPLY = process.argv.includes('--fix');

const argValue = (name: string): string | undefined =>
  process.argv
    .find((arg) => arg.startsWith(`--${name}=`))
    ?.split('=')
    .slice(1)
    .join('=');

const COMPANY_FILTER = argValue('company');
const EMISSOR_FILTER = argValue('emissor');

const ENVIRONMENTS = ['HOMOLOGACAO', 'PRODUCAO'] as const;
type Environment = (typeof ENVIRONMENTS)[number];

/**
 * Status que significam "este número foi entregue à autorizadora".
 *
 * REJECTED fica de fora de propósito: número rejeitado não foi consumido na
 * SEFAZ, e puxar o contador por causa dele abriria lacuna na sequência — que
 * depois exigiria inutilização.
 */
const CONSUMED_NFE: NfeStatus[] = [
  'AUTHORIZED',
  'CANCELLED',
  'CORRECTION_SENT',
];
const CONSUMED_NFCE: NfceStatus[] = [
  'AUTHORIZED',
  'CANCELLED',
  'CONTINGENCY',
  'UNKNOWN',
];
const CONSUMED_NFSE: NfseStatus[] = ['AUTHORIZED', 'CANCELLED'];

interface Divergencia {
  emissorId: string;
  emissorNome: string;
  companyId: string;
  environment: Environment;
  docType: 'NFE' | 'NFCE' | 'NFSE';
  serie: string;
  atual: number;
  maiorUsado: number;
  sugerido: number;
}

function ambienteNumerico(environment: Environment): number {
  return environment === 'PRODUCAO' ? 1 : 2;
}

/**
 * Documento pertence a este emissor quando tem `invoicyConfigId`
 * (rastreabilidade da Fase 1); os anteriores nasceram sem essa coluna e são
 * atribuídos pela empresa. Empresa com mais de um emissor pode ter o número de
 * um contado para o outro nesse fallback — por isso o relatório sai antes da
 * correção, para conferência.
 */
function escopoDoEmissor(emissorId: string, companyId: string) {
  return [{ invoicyConfigId: emissorId }, { invoicyConfigId: null, companyId }];
}

/** Maior número já entregue à autorizadora naquela série/ambiente. */
async function maiorNumeroUsado(
  prisma: PrismaClient,
  docType: 'NFE' | 'NFCE' | 'NFSE',
  emissorId: string,
  companyId: string,
  serie: string,
  ambiente: number,
): Promise<number> {
  const OR = escopoDoEmissor(emissorId, companyId);

  if (docType === 'NFE') {
    const { _max } = await prisma.nfe.aggregate({
      _max: { numero: true },
      where: {
        OR,
        ambiente,
        serie: Number(serie),
        status: { in: CONSUMED_NFE },
      },
    });
    return _max.numero ?? 0;
  }

  if (docType === 'NFCE') {
    const { _max } = await prisma.nfce.aggregate({
      _max: { numero: true },
      where: {
        OR,
        ambiente,
        serie: Number(serie),
        status: { in: CONSUMED_NFCE },
      },
    });
    return _max.numero ?? 0;
  }

  // A numeração da NFS-e controla o RPS, não o número da nota — quem numera a
  // NFS-e é a prefeitura. A série do RPS é alfanumérica.
  const { _max } = await prisma.nfse.aggregate({
    _max: { rpsNumero: true },
    where: {
      OR,
      ambiente,
      rpsSerie: serie,
      status: { in: CONSUMED_NFSE },
    },
  });
  return _max.rpsNumero ?? 0;
}

async function auditar(prisma: PrismaClient): Promise<Divergencia[]> {
  const emissores = await prisma.invoicyConfig.findMany({
    where: {
      ...(COMPANY_FILTER ? { companyId: COMPANY_FILTER } : {}),
      ...(EMISSOR_FILTER ? { id: EMISSOR_FILTER } : {}),
    },
    include: { environmentConfigs: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`[AUDITORIA] ${emissores.length} emissor(es) no escopo.\n`);

  const divergencias: Divergencia[] = [];

  for (const emissor of emissores) {
    for (const environment of ENVIRONMENTS) {
      const ambiente = ambienteNumerico(environment);

      const alvos = [
        {
          docType: 'NFE' as const,
          seriesColumn: 'nfeSeries' as const,
          numberColumn: 'nfeNextNumber' as const,
          serieLegada: emissor.serieNfe,
          serieDefault: '1',
        },
        {
          docType: 'NFCE' as const,
          seriesColumn: 'nfceSeries' as const,
          numberColumn: 'nfceNextNumber' as const,
          serieLegada: emissor.serieNfce,
          serieDefault: '1',
        },
        {
          docType: 'NFSE' as const,
          seriesColumn: 'nfseSeries' as const,
          numberColumn: 'nfseNextNumber' as const,
          serieLegada: emissor.serieNfse,
          serieDefault: 'A1',
        },
      ];

      for (const alvo of alvos) {
        const linha = emissor.environmentConfigs.find(
          (ec) => ec.environment === environment && ec.docType === alvo.docType,
        );

        const serie = String(
          linha?.[alvo.seriesColumn] ?? alvo.serieLegada ?? alvo.serieDefault,
        );
        const atual = linha?.[alvo.numberColumn] ?? 1;

        const maiorUsado = await maiorNumeroUsado(
          prisma,
          alvo.docType,
          emissor.id,
          emissor.companyId,
          serie,
          ambiente,
        );

        if (maiorUsado === 0 || atual > maiorUsado) continue;

        divergencias.push({
          emissorId: emissor.id,
          emissorNome: emissor.name,
          companyId: emissor.companyId,
          environment,
          docType: alvo.docType,
          serie,
          atual,
          maiorUsado,
          sugerido: maiorUsado + 1,
        });
      }
    }
  }

  return divergencias;
}

async function corrigir(
  prisma: PrismaClient,
  divergencias: Divergencia[],
): Promise<void> {
  for (const d of divergencias) {
    const coluna =
      d.docType === 'NFE'
        ? 'nfeNextNumber'
        : d.docType === 'NFCE'
          ? 'nfceNextNumber'
          : 'nfseNextNumber';

    // upsert: emissor anterior à Fase 3 pode não ter a linha do ambiente.
    await prisma.invoicyEnvironmentConfig.upsert({
      where: {
        invoicyConfigId_environment_docType: {
          invoicyConfigId: d.emissorId,
          environment: d.environment,
          docType: d.docType,
        },
      },
      create: {
        invoicyConfigId: d.emissorId,
        environment: d.environment,
        docType: d.docType,
        status: 'DRAFT',
        [coluna]: d.sugerido,
      },
      update: { [coluna]: d.sugerido },
    });

    console.log(
      `[CORRIGIDO] ${d.emissorNome} · ${d.docType} · ${d.environment} · série ${d.serie}: ${d.atual} -> ${d.sugerido}`,
    );
  }
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();

  try {
    const divergencias = await auditar(prisma);

    if (divergencias.length === 0) {
      console.log(
        '[OK] Nenhuma sequência abaixo do que já foi emitido neste banco.',
      );
      console.log(
        '     Lembre que notas emitidas fora do Atrupe não aparecem aqui.',
      );
      return;
    }

    console.log(
      `[ATENCAO] ${divergencias.length} sequência(s) vão duplicar número na próxima emissão:\n`,
    );
    for (const d of divergencias) {
      console.log(
        `  ${d.emissorNome} (${d.emissorId})\n` +
          `    ${d.docType} · ${d.environment} · série ${d.serie}\n` +
          `    contador em ${d.atual}, maior já emitido ${d.maiorUsado} -> deveria ser ${d.sugerido}\n`,
      );
    }

    if (!APPLY) {
      console.log(
        'Nada foi alterado. Rode novamente com --fix para aplicar os valores sugeridos.',
      );
      return;
    }

    console.log('[FIX] Aplicando...\n');
    await corrigir(prisma, divergencias);
    console.log(`\n[FIX] ${divergencias.length} sequência(s) corrigida(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('[ERRO]', error);
  process.exit(1);
});
