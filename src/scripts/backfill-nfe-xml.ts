#!/usr/bin/env node
/**
 * Recupera do provedor o XML das NF-e autorizadas que ficaram sem ele.
 *
 * O XML só era gravado na resposta síncrona da emissão. Quando ela vinha sem
 * DocXMLBase64, ou quando a nota era autorizada depois pela consulta de
 * status, a NF-e ficava AUTHORIZED sem XML: sumia da exportação em ZIP e do
 * "Baixar XML". A exportação e a consulta de status passaram a rebuscar o XML
 * sob demanda; este script cobre o estoque antigo de uma vez.
 *
 * É idempotente (só toca nota sem XML) e nunca apaga nada. Anda devagar de
 * propósito: o provedor limita chamadas por minuto (429).
 *
 * Uso:
 *   npm run fiscal:xml:backfill:dry                       # relatório, não escreve
 *   npm run fiscal:xml:backfill                           # aplica em todas
 *   npm run fiscal:xml:backfill -- --company=<id>         # só uma empresa
 *   npm run fiscal:xml:backfill -- --since=2026-01-01     # só notas a partir da data
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { AppModule } from '../app.module';
import { NfeService } from '../core/fiscal/nfe/nfe.service';

const DRY_RUN = process.argv.includes('--dry-run');
const ONLY_COMPANY = argumento('--company');
const SINCE = argumento('--since');
const PAUSA_MS = 1500;

function argumento(flag: string): string | undefined {
  return process.argv.find((arg) => arg.startsWith(`${flag}=`))?.split('=')[1];
}

const pausar = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const logger = new Logger('BackfillNfeXml');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const prisma = app.get(PrismaService);
    const nfeService = app.get(NfeService);

    const notas = await prisma.nfe.findMany({
      where: {
        status: { in: ['AUTHORIZED', 'CORRECTION_SENT'] },
        xmlAutorizado: null,
        chaveAcesso: { not: null },
        ...(ONLY_COMPANY ? { companyId: ONLY_COMPANY } : {}),
        ...(SINCE
          ? { createdAt: { gte: new Date(`${SINCE}T00:00:00-03:00`) } }
          : {}),
      },
      select: {
        id: true,
        companyId: true,
        numero: true,
        serie: true,
        ambiente: true,
        chaveAcesso: true,
        invoicyConfigId: true,
        dataAutorizacao: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    logger.log(
      `${notas.length} NF-e autorizada(s) sem XML${DRY_RUN ? ' (dry-run, nada será gravado)' : ''}.`,
    );

    if (DRY_RUN) {
      for (const nota of notas) {
        logger.log(
          `  empresa ${nota.companyId} nº ${nota.numero}/${nota.serie} amb ${nota.ambiente} chave ${nota.chaveAcesso}`,
        );
      }
      return;
    }

    let recuperados = 0;
    const falhas: string[] = [];
    for (const nota of notas) {
      const xml = await nfeService.refreshXmlFromProvider(nota, nota.companyId);
      if (xml) {
        recuperados++;
      } else {
        falhas.push(
          `empresa ${nota.companyId} nº ${nota.numero}/${nota.serie} chave ${nota.chaveAcesso}`,
        );
      }
      await pausar(PAUSA_MS);
    }

    logger.log(
      `Recuperados: ${recuperados}. Sem XML no provedor: ${falhas.length}.`,
    );
    for (const falha of falhas) logger.warn(`  ${falha}`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
