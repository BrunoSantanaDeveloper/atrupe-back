#!/usr/bin/env node
/**
 * Reenvia ao Invoicy os dados cadastrais das empresas já cadastradas.
 *
 * O cadastro no Invoicy só recebe razão social, IE, nome fantasia e endereço na
 * CRIAÇÃO: `registerCompany` consulta se a empresa já existe e, se existir,
 * devolve a chave de acesso e sai. Quem editou esses dados depois — ou teve o
 * cadastro criado por outra via, como o backfill de credenciais — ficou com o
 * provedor defasado indefinidamente.
 *
 * Isso não aparece na NF-e, cujo grupo `emit` é montado a cada emissão a partir
 * do nosso banco, mas aparece nos documentos que o próprio Invoicy monta a
 * partir do cadastro. Foi assim que o problema apareceu: a DACCE (carta de
 * correção impressa) saía com razão social e IE em branco.
 *
 * Só toca ambientes em que a empresa JÁ tem credencial — nunca cria cadastro
 * novo — e recusa empresa sem CNPJ ou sem razão social, porque sobrescrever o
 * cadastro com vazio é pior que deixá-lo desatualizado. É idempotente.
 *
 * Uso:
 *   npm run invoicy:sync-cadastro:dry              # relatório, não escreve
 *   npm run invoicy:sync-cadastro                  # aplica em todas
 *   npm run invoicy:sync-cadastro -- --company=<id>  # aplica em uma só
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { PrismaService } from '../config/prisma/prisma.service';
import { InvoicyCompanyRegistrationService } from '../core/fiscal/invoicy/invoicy-company-registration.service';

const DRY_RUN = process.argv.includes('--dry-run');
const ONLY_COMPANY = process.argv
  .find((arg) => arg.startsWith('--company='))
  ?.split('=')[1];

async function main() {
  const logger = new Logger('SyncInvoicyRegistration');

  // Contexto sem HTTP: o serviço depende de EncryptionService e ConfigService.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const prisma = app.get(PrismaService);
    const registrationService = app.get(InvoicyCompanyRegistrationService);

    // Só empresas que têm credencial em algum ambiente, isto é, que realmente
    // existem no Invoicy.
    const companies = await prisma.company.findMany({
      where: {
        ...(ONLY_COMPANY ? { id: ONLY_COMPANY } : {}),
        environmentCredentials: {
          some: { providerAccessKeyEncrypted: { not: null } },
        },
      },
      select: {
        id: true,
        name: true,
        legalName: true,
        cnpj: true,
        stateRegistration: true,
        environmentCredentials: {
          where: { providerAccessKeyEncrypted: { not: null } },
          select: { environment: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    logger.log(`${companies.length} empresa(s) cadastrada(s) no Invoicy.`);

    const skipped: string[] = [];
    const failed: string[] = [];
    let synced = 0;

    for (const company of companies) {
      const razaoSocial = company.legalName || company.name;
      const cnpj = (company.cnpj ?? '').replace(/\D/g, '');
      const ambientes = company.environmentCredentials
        .map((c) => c.environment)
        .join(', ');
      const label = `${company.name} (${company.id})`;

      if (!cnpj || !razaoSocial) {
        skipped.push(`${label}: sem CNPJ ou razão social`);
        continue;
      }

      if (DRY_RUN) {
        logger.log(
          `[DRY] ${label} → ${ambientes} | razão="${razaoSocial}" IE="${
            company.stateRegistration || 'ISENTO'
          }"`,
        );
        synced++;
        continue;
      }

      try {
        const environments = await registrationService.syncRegistrationData(
          company.id,
        );
        logger.log(`OK ${label} → ${environments.join(', ')}`);
        synced++;
      } catch (error) {
        // Uma empresa com problema no provedor não pode abortar as demais.
        failed.push(`${label}: ${error.message}`);
        logger.error(`FALHOU ${label}: ${error.message}`);
      }
    }

    logger.log('');
    logger.log(
      DRY_RUN
        ? `DRY RUN — ${synced} empresa(s) seriam sincronizadas.`
        : `${synced} empresa(s) sincronizadas.`,
    );

    if (skipped.length) {
      logger.warn(`${skipped.length} ignorada(s):`);
      skipped.forEach((item) => logger.warn(`  - ${item}`));
    }

    if (failed.length) {
      logger.error(`${failed.length} com falha:`);
      failed.forEach((item) => logger.error(`  - ${item}`));
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
