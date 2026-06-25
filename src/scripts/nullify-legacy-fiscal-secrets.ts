#!/usr/bin/env node
/**
 * Nullify legacy fiscal secrets after encrypted credentials are reconciled.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import {
  loadKeyring,
  decrypt,
  deriveEnvironment,
  Keyring,
} from './fiscal-secret-crypto';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const DRY_RUN = process.argv.includes('--dry-run');

function checkEnvPreconditions(): void {
  if (process.env.USE_ENCRYPTED_FISCAL_DB !== 'true') {
    throw new Error(
      'ABORT: USE_ENCRYPTED_FISCAL_DB deve ser "true" (Fase 6+) antes de nullificar segredos legados.',
    );
  }
  if (process.env.FISCAL_DB_WRITE_MODE !== 'ENCRYPTED_ONLY') {
    throw new Error(
      'ABORT: FISCAL_DB_WRITE_MODE deve ser "ENCRYPTED_ONLY" (Fase 7+) antes de nullificar.',
    );
  }
}

async function checkMigrationCompleted(prisma: PrismaClient): Promise<void> {
  const state = await prisma.fiscalSecretMigrationState.findUnique({
    where: { version: 1 },
  });
  if (!state || state.status !== 'COMPLETED') {
    throw new Error(
      `ABORT: FiscalSecretMigrationState.status = "${state?.status ?? 'nao encontrado'}". ` +
        'Execute npm run fiscal:migrate antes do nullify.',
    );
  }
}

async function reconcile(prisma: PrismaClient, kr: Keyring): Promise<void> {
  console.log('[RECONCILIAR] Verificando integridade antes de nullificar...');

  const companiesWithKey = await prisma.company.findMany({
    where: { accessKey: { not: null } },
    select: { id: true },
  });

  for (const company of companiesWithKey) {
    const creds = await prisma.companyEnvironmentCredential.findMany({
      where: {
        companyId: company.id,
        providerAccessKeyEncrypted: { not: null },
      },
    });

    if (creds.length === 0) {
      throw new Error(
        `ABORT: Empresa ${company.id} tem accessKey sem nenhum CompanyEnvironmentCredential cifrado. ` +
          'Execute o script de migracao novamente.',
      );
    }

    const canDecrypt = creds.some((credential) => {
      try {
        decrypt(
          credential.providerAccessKeyEncrypted!,
          {
            table: 'company_environment_credentials',
            recordId: credential.id,
            companyId: company.id,
            field: 'providerAccessKeyEncrypted',
            scope: credential.environment as any,
          },
          kr,
        );
        return true;
      } catch {
        return false;
      }
    });

    if (!canDecrypt) {
      throw new Error(
        `ABORT: Empresa ${company.id} - nenhuma credencial cifrada e descriptografavel com o keyring atual.`,
      );
    }
  }

  const configsWithCsc = await prisma.invoicyConfig.findMany({
    where: { cscToken: { not: null } },
    select: {
      id: true,
      companyId: true,
      activeEnvironment: true,
      environment: true,
      ambiente: true,
    },
  });

  for (const config of configsWithCsc) {
    const env = deriveEnvironment({
      activeEnvironment: config.activeEnvironment,
      environment: config.environment,
      ambiente: config.ambiente,
    });

    const envConfig = await prisma.invoicyEnvironmentConfig.findUnique({
      where: {
        invoicyConfigId_environment: {
          invoicyConfigId: config.id,
          environment: env as any,
        },
      },
    });

    if (!envConfig?.cscTokenEncrypted) {
      throw new Error(
        `ABORT: InvoicyConfig ${config.id} tem cscToken sem InvoicyEnvironmentConfig cifrado ` +
          `para ambiente ${env}. Execute o script de migracao novamente.`,
      );
    }

    try {
      decrypt(
        envConfig.cscTokenEncrypted,
        {
          table: 'invoicy_environment_configs',
          recordId: envConfig.id,
          companyId: config.companyId,
          field: 'cscTokenEncrypted',
          scope: env,
        },
        kr,
      );
    } catch {
      throw new Error(
        `ABORT: InvoicyConfig ${config.id} - cscTokenEncrypted nao e descriptografavel com o keyring atual.`,
      );
    }
  }

  const certsWithPlaintext = await prisma.digitalCertificate.findMany({
    where: { certificate: { not: null } },
    select: {
      id: true,
      companyId: true,
      password: true,
      certificateEncrypted: true,
      passwordEncrypted: true,
    },
  });

  for (const cert of certsWithPlaintext) {
    if (!cert.certificateEncrypted) {
      throw new Error(
        `ABORT: DigitalCertificate ${cert.id} tem certificate sem certificateEncrypted. ` +
          'Execute o script de migracao novamente.',
      );
    }

    try {
      decrypt(
        cert.certificateEncrypted,
        {
          table: 'digital_certificates',
          recordId: cert.id,
          companyId: cert.companyId,
          field: 'certificateEncrypted',
          scope: 'GLOBAL',
        },
        kr,
      );
    } catch {
      throw new Error(
        `ABORT: DigitalCertificate ${cert.id} - certificateEncrypted nao e descriptografavel com o keyring atual.`,
      );
    }

    if (cert.password && !cert.passwordEncrypted) {
      throw new Error(
        `ABORT: DigitalCertificate ${cert.id} tem password sem passwordEncrypted. ` +
          'Execute o script de migracao novamente.',
      );
    }

    if (cert.password && cert.passwordEncrypted) {
      try {
        decrypt(
          cert.passwordEncrypted,
          {
            table: 'digital_certificates',
            recordId: cert.id,
            companyId: cert.companyId,
            field: 'passwordEncrypted',
            scope: 'GLOBAL',
          },
          kr,
        );
      } catch {
        throw new Error(
          `ABORT: DigitalCertificate ${cert.id} - passwordEncrypted nao e descriptografavel com o keyring atual.`,
        );
      }
    }
  }

  console.log('[OK] Reconciliacao concluida sem inconsistencias.');
}

async function printDryRunCounts(prisma: PrismaClient): Promise<void> {
  const [companies, configs, certs] = await Promise.all([
    prisma.company.count({ where: { accessKey: { not: null } } }),
    prisma.invoicyConfig.count({ where: { cscToken: { not: null } } }),
    prisma.digitalCertificate.count({
      where: {
        certificate: { not: null },
        certificateEncrypted: { not: null },
      },
    }),
  ]);
  console.log(
    `[DRY-RUN] Seriam afetados: ` +
      `Company.accessKey=${companies} | InvoicyConfig.cscToken=${configs} | DigitalCertificate=${certs}`,
  );
}

export async function runNullify(
  prisma: PrismaClient,
  kr: Keyring,
  isDryRun: boolean,
): Promise<void> {
  checkEnvPreconditions();
  await checkMigrationCompleted(prisma);
  await reconcile(prisma, kr);

  if (isDryRun) {
    await printDryRunCounts(prisma);
    return;
  }

  console.log('[NULLIFY] Zerando colunas legadas...');

  const [r1, r2, r3] = await Promise.all([
    prisma.company.updateMany({
      where: { accessKey: { not: null } },
      data: { accessKey: null },
    }),
    prisma.invoicyConfig.updateMany({
      where: { cscToken: { not: null } },
      data: { cscToken: null },
    }),
    prisma.digitalCertificate.updateMany({
      where: {
        certificateEncrypted: { not: null },
        certificate: { not: null },
      },
      data: { certificate: null, password: null },
    }),
  ]);

  console.log(
    `[CONCLUIDO] Zerados: Company=${r1.count} | InvoicyConfig=${r2.count} | DigitalCertificate=${r3.count}`,
  );
}

async function main() {
  let prisma: PrismaClient | undefined;
  try {
    const kr = loadKeyring();
    prisma = new PrismaClient();
    await runNullify(prisma, kr, DRY_RUN);
    process.exit(0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n[ERRO] ${msg}`);
    process.exit(1);
  } finally {
    await prisma?.$disconnect();
  }
}

if (require.main === module) {
  main();
}
