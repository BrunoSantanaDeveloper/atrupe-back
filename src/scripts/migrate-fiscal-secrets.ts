#!/usr/bin/env node
/**
 * Script de migração de segredos fiscais (Plano 6 — P1).
 *
 * Backfill único das colunas cifradas a partir das colunas legadas plaintext:
 *   Company.accessKey           → CompanyEnvironmentCredential.providerAccessKeyEncrypted
 *   InvoicyConfig.cscToken      → InvoicyEnvironmentConfig.cscTokenEncrypted
 *   DigitalCertificate.certificate/password → certificateEncrypted/passwordEncrypted
 *
 * Características:
 *   - Idempotente: registros já migrados são pulados
 *   - Cursor-based: retomável via FiscalSecretMigrationState.cursors
 *   - Dry-run: --dry-run percorre e valida sem escrever
 *   - Seguro: nunca grava segredos em logs ou errorSanitized
 *
 * Uso:
 *   node dist/src/scripts/migrate-fiscal-secrets.js           # VPS/container
 *   npx ts-node src/scripts/migrate-fiscal-secrets.ts         # dev local
 *   npx ts-node src/scripts/migrate-fiscal-secrets.ts --dry-run
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import {
  loadKeyring,
  encrypt,
  deriveEnvironment,
  Keyring,
} from './fiscal-secret-crypto';

// Carrega .env do diretório pai (raiz do projeto backend)
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const BATCH_SIZE = 50;
const DRY_RUN = process.argv.includes('--dry-run');

// ── Tipos internos ────────────────────────────────────────────────────────────

interface Cursor {
  createdAt: string;
  id: string;
}

interface Cursors {
  Company?: Cursor;
  InvoicyConfig?: Cursor;
  DigitalCertificate?: Cursor;
}

interface Progress {
  company: { done: number; total: number };
  invoicyConfig: { done: number; total: number };
  cert: { done: number; total: number };
}

// ── Helpers de progresso ──────────────────────────────────────────────────────

function printProgress(p: Progress) {
  process.stdout.write(
    `\r[${DRY_RUN ? 'DRY-RUN' : 'OK'}] ` +
      `Company ${p.company.done}/${p.company.total} | ` +
      `InvoicyConfig ${p.invoicyConfig.done}/${p.invoicyConfig.total} | ` +
      `Cert ${p.cert.done}/${p.cert.total}   `,
  );
}

function sanitizeError(err: unknown): string {
  if (!(err instanceof Error)) return 'Erro desconhecido';
  // Remove valores que possam ser secrets (conteúdo longo, base64, hex)
  return err.message
    .replace(/[A-Za-z0-9+/=]{20,}/g, '[REDACTED]')
    .slice(0, 500);
}

// ── Bloco 1: CompanyEnvironmentCredential ────────────────────────────────────

async function migrateCompanyCredentials(
  prisma: PrismaClient,
  kr: Keyring,
  cursors: Cursors,
  progress: Progress,
  isDryRun: boolean,
): Promise<void> {
  const cursor = cursors.Company;

  const where: any = { accessKey: { not: null } };
  if (cursor) {
    where.OR = [
      { createdAt: { gt: new Date(cursor.createdAt) } },
      { createdAt: new Date(cursor.createdAt), id: { gt: cursor.id } },
    ];
  }

  const companies = await prisma.company.findMany({
    where,
    select: { id: true, accessKey: true, createdAt: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: BATCH_SIZE,
  });

  if (companies.length === 0) return;

  for (const company of companies) {
    // Busca todos os emissores da empresa para derivar ambientes operacionais
    const emissores = await prisma.invoicyConfig.findMany({
      where: { companyId: company.id },
      select: { activeEnvironment: true, environment: true, ambiente: true },
    });

    if (emissores.length === 0) {
      console.warn(
        `\n[AVISO] Empresa ${company.id} tem accessKey sem emissores. Pulando.`,
      );
      progress.company.done++;
      printProgress(progress);
      continue;
    }

    // Deriva conjunto único de ambientes operacionais
    const environments = new Set(
      emissores.map((e) =>
        deriveEnvironment({
          activeEnvironment: e.activeEnvironment,
          environment: e.environment,
          ambiente: e.ambiente,
        }),
      ),
    );

    for (const env of environments) {
      if (isDryRun) continue;

      // Passo 1: upsert sem chave para obter ID estável
      const cred = await prisma.companyEnvironmentCredential.upsert({
        where: {
          companyId_environment: {
            companyId: company.id,
            environment: env as any,
          },
        },
        create: { companyId: company.id, environment: env as any },
        update: {},
      });

      // Passo 2: pular se já cifrado
      if (cred.providerAccessKeyEncrypted) continue;

      // Passo 3: cifrar com AAD correto (recordId = cred.id)
      const envelope = encrypt(
        company.accessKey!,
        {
          table: 'company_environment_credentials',
          recordId: cred.id,
          companyId: company.id,
          field: 'providerAccessKeyEncrypted',
          scope: env,
        },
        kr,
      );

      await prisma.companyEnvironmentCredential.update({
        where: { id: cred.id },
        data: { providerAccessKeyEncrypted: envelope },
      });
    }

    progress.company.done++;
    printProgress(progress);
  }

  // Atualiza cursor
  const last = companies[companies.length - 1];
  cursors.Company = { createdAt: last.createdAt.toISOString(), id: last.id };

  if (companies.length === BATCH_SIZE) {
    await migrateCompanyCredentials(prisma, kr, cursors, progress, isDryRun);
  }
}

// ── Bloco 2: InvoicyEnvironmentConfig ────────────────────────────────────────

async function migrateInvoicyConfigs(
  prisma: PrismaClient,
  kr: Keyring,
  cursors: Cursors,
  progress: Progress,
  isDryRun: boolean,
): Promise<void> {
  const cursor = cursors.InvoicyConfig;

  const where: any = { cscToken: { not: null } };
  if (cursor) {
    where.OR = [
      { createdAt: { gt: new Date(cursor.createdAt) } },
      { createdAt: new Date(cursor.createdAt), id: { gt: cursor.id } },
    ];
  }

  const configs = await prisma.invoicyConfig.findMany({
    where,
    select: {
      id: true,
      companyId: true,
      cscToken: true,
      cscId: true,
      serieNfce: true,
      proximoNumeroNfce: true,
      activeEnvironment: true,
      environment: true,
      ambiente: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: BATCH_SIZE,
  });

  if (configs.length === 0) return;

  for (const config of configs) {
    const env = deriveEnvironment({
      activeEnvironment: config.activeEnvironment,
      environment: config.environment,
      ambiente: config.ambiente,
    });

    if (isDryRun) {
      progress.invoicyConfig.done++;
      continue;
    }

    // Passo 1: upsert preservando nfceSeries/nfceNextNumber existentes
    const existing = await prisma.invoicyEnvironmentConfig.findUnique({
      where: {
        invoicyConfigId_environment: {
          invoicyConfigId: config.id,
          environment: env as any,
        },
      },
    });

    let envConfig: { id: string; cscTokenEncrypted: string | null };
    if (existing) {
      envConfig = existing;
    } else {
      envConfig = await prisma.invoicyEnvironmentConfig.create({
        data: {
          invoicyConfigId: config.id,
          environment: env as any,
          nfceSeries: config.serieNfce ?? 1,
          nfceNextNumber: config.proximoNumeroNfce ?? 1,
        },
      });
    }

    // Passo 2: pular se já cifrado
    if (envConfig.cscTokenEncrypted) {
      progress.invoicyConfig.done++;
      printProgress(progress);
      continue;
    }

    // Passo 3: cifrar com AAD correto (recordId = envConfig.id)
    const envelope = encrypt(
      config.cscToken!,
      {
        table: 'invoicy_environment_configs',
        recordId: envConfig.id,
        companyId: config.companyId,
        field: 'cscTokenEncrypted',
        scope: env,
      },
      kr,
    );

    await prisma.invoicyEnvironmentConfig.update({
      where: { id: envConfig.id },
      data: {
        cscTokenEncrypted: envelope,
        cscId: existing?.cscId ?? config.cscId,
        nfceSeries: existing?.nfceSeries ?? config.serieNfce ?? 1,
        nfceNextNumber:
          existing?.nfceNextNumber ?? config.proximoNumeroNfce ?? 1,
        status: 'MIGRATED_UNVERIFIED' as any,
      },
    });

    progress.invoicyConfig.done++;
    printProgress(progress);
  }

  const last = configs[configs.length - 1];
  cursors.InvoicyConfig = {
    createdAt: last.createdAt.toISOString(),
    id: last.id,
  };

  if (configs.length === BATCH_SIZE) {
    await migrateInvoicyConfigs(prisma, kr, cursors, progress, isDryRun);
  }
}

// ── Bloco 3: DigitalCertificate ───────────────────────────────────────────────

async function migrateCertificates(
  prisma: PrismaClient,
  kr: Keyring,
  cursors: Cursors,
  progress: Progress,
  isDryRun: boolean,
): Promise<void> {
  const cursor = cursors.DigitalCertificate;

  const where: any = {
    certificate: { not: null },
    certificateEncrypted: null,
  };
  if (cursor) {
    where.OR = [
      { createdAt: { gt: new Date(cursor.createdAt) } },
      { createdAt: new Date(cursor.createdAt), id: { gt: cursor.id } },
    ];
  }

  const certs = await prisma.digitalCertificate.findMany({
    where,
    select: {
      id: true,
      companyId: true,
      certificate: true,
      password: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: BATCH_SIZE,
  });

  if (certs.length === 0) return;

  for (const cert of certs) {
    if (isDryRun) {
      progress.cert.done++;
      continue;
    }

    const certEnvelope = encrypt(
      cert.certificate!,
      {
        table: 'digital_certificates',
        recordId: cert.id,
        companyId: cert.companyId,
        field: 'certificateEncrypted',
        scope: 'GLOBAL',
      },
      kr,
    );

    let passwordEnvelope: string | null = null;
    if (cert.password) {
      passwordEnvelope = encrypt(
        cert.password,
        {
          table: 'digital_certificates',
          recordId: cert.id,
          companyId: cert.companyId,
          field: 'passwordEncrypted',
          scope: 'GLOBAL',
        },
        kr,
      );
    }

    await prisma.digitalCertificate.update({
      where: { id: cert.id },
      data: {
        certificateEncrypted: certEnvelope,
        ...(passwordEnvelope ? { passwordEncrypted: passwordEnvelope } : {}),
      },
    });

    progress.cert.done++;
    printProgress(progress);
  }

  const last = certs[certs.length - 1];
  cursors.DigitalCertificate = {
    createdAt: last.createdAt.toISOString(),
    id: last.id,
  };

  if (certs.length === BATCH_SIZE) {
    await migrateCertificates(prisma, kr, cursors, progress, isDryRun);
  }
}

// ── Contagens totais ──────────────────────────────────────────────────────────

async function countTotals(
  prisma: PrismaClient,
): Promise<{ companies: number; configs: number; certs: number }> {
  const [companies, configs, certs] = await Promise.all([
    prisma.company.count({ where: { accessKey: { not: null } } }),
    prisma.invoicyConfig.count({ where: { cscToken: { not: null } } }),
    prisma.digitalCertificate.count({
      where: { certificate: { not: null }, certificateEncrypted: null },
    }),
  ]);
  return { companies, configs, certs };
}

// ── Entry point exportado (testável) ─────────────────────────────────────────

export async function runMigration(
  prisma: PrismaClient,
  kr: Keyring,
  isDryRun: boolean,
): Promise<void> {
  if (isDryRun) {
    const cursors: Cursors = {};
    const totals = await countTotals(prisma);
    const progress: Progress = {
      company: { done: 0, total: totals.companies },
      invoicyConfig: { done: 0, total: totals.configs },
      cert: { done: 0, total: totals.certs },
    };

    console.log(
      `\n[INFO] Totais a migrar: ` +
        `Company=${totals.companies} | InvoicyConfig=${totals.configs} | Cert=${totals.certs}`,
    );
    console.log('[DRY-RUN] Nenhuma escrita sera realizada.\n');

    await migrateCompanyCredentials(prisma, kr, cursors, progress, true);
    await migrateInvoicyConfigs(prisma, kr, cursors, progress, true);
    await migrateCertificates(prisma, kr, cursors, progress, true);

    const totalRecords = totals.companies + totals.configs + totals.certs;
    const processedOk =
      progress.company.done + progress.invoicyConfig.done + progress.cert.done;
    console.log(
      `\n[CONCLUIDO] (dry-run) ${processedOk}/${totalRecords} registros processados.`,
    );
    return;
  }

  // Upsert do estado de migração
  const state = await prisma.fiscalSecretMigrationState.upsert({
    where: { version: 1 },
    create: {
      version: 1,
      status: 'RUNNING',
      startedAt: new Date(),
      snapshotTime: new Date(),
    },
    update: { status: 'RUNNING', snapshotTime: new Date() },
  });

  if (state.status === 'COMPLETED' && !isDryRun) {
    console.log(
      '[OK] Migração já foi COMPLETED anteriormente. Nenhuma ação necessária.',
    );
    return;
  }

  const cursors: Cursors = (state.cursors as Cursors) ?? {};

  const totals = await countTotals(prisma);
  const progress: Progress = {
    company: { done: 0, total: totals.companies },
    invoicyConfig: { done: 0, total: totals.configs },
    cert: { done: 0, total: totals.certs },
  };

  console.log(
    `\n[INFO] Totais a migrar: ` +
      `Company=${totals.companies} | InvoicyConfig=${totals.configs} | Cert=${totals.certs}`,
  );
  if (isDryRun) console.log('[DRY-RUN] Nenhuma escrita será realizada.\n');

  try {
    await migrateCompanyCredentials(prisma, kr, cursors, progress, isDryRun);
    await migrateInvoicyConfigs(prisma, kr, cursors, progress, isDryRun);
    await migrateCertificates(prisma, kr, cursors, progress, isDryRun);

    const totalRecords = totals.companies + totals.configs + totals.certs;
    const processedOk =
      progress.company.done + progress.invoicyConfig.done + progress.cert.done;

    if (!isDryRun) {
      await prisma.fiscalSecretMigrationState.update({
        where: { version: 1 },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          totalRecords,
          processedOk,
          cursors: cursors as any,
        },
      });
    }

    console.log(
      `\n[CONCLUÍDO] ${isDryRun ? '(dry-run) ' : ''}` +
        `${processedOk}/${totalRecords} registros processados.`,
    );
  } catch (err) {
    const errorSanitized = sanitizeError(err);
    if (!isDryRun) {
      await prisma.fiscalSecretMigrationState.update({
        where: { version: 1 },
        data: {
          status: 'FAILED',
          errorSanitized,
          cursors: cursors as any,
        },
      });
    }
    console.error(`\n[ERRO] ${errorSanitized}`);
    throw err;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  let prisma: PrismaClient | undefined;
  try {
    const kr = loadKeyring();
    prisma = new PrismaClient();
    await runMigration(prisma, kr, DRY_RUN);
    process.exit(0);
  } catch (err) {
    process.exit(1);
  } finally {
    await prisma?.$disconnect();
  }
}

// Executa apenas quando chamado diretamente (não quando importado em testes)
if (require.main === module) {
  main();
}
