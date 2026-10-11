#!/usr/bin/env node
/**
 * Contas de teste por plano (homolog).
 *
 * Uma empresa por plano (TRIAL, START, LITE, PRO, ELITE, FULL) e por família
 * (`demo-*` para o Maicol aprovar, `e2e-*` para a automação), criada pelos
 * mesmos serviços do cadastro, com assinatura `manual_` ACTIVE (o cron de
 * cobrança a ignora), empresa desbloqueada, um usuário por cargo e dados
 * fictícios. Detalhes, variáveis e o que cada conta tem: docs/test-accounts.md.
 *
 * Só roda com a guarda tripla (guard.ts): TEST_ACCOUNTS_ENABLED=true, APP_ENV
 * diferente de production, Asaas em sandbox e banco com nome diferente do de
 * produção. A guarda vale também para --dry-run.
 *
 * Uso (no container de homolog):
 *   node dist/src/scripts/test-accounts/seed-test-accounts.js                 # --garantir
 *   node dist/src/scripts/test-accounts/seed-test-accounts.js --dry-run       # só relata
 *   node dist/src/scripts/test-accounts/seed-test-accounts.js --planos START,LITE
 *   node dist/src/scripts/test-accounts/seed-test-accounts.js --familias e2e
 *   node dist/src/scripts/test-accounts/seed-test-accounts.js --refazer-dados # só e2e-*
 */

import './load-env';
import { FIXTURES_VERSION, PLAN_FIXTURES } from './fixtures';
import {
  checkAsaasGuard,
  checkEnvironmentGuards,
  describeGuardFailures,
} from './guard';
import { parseOptions, readSettings, TestAccountsUsageError } from './options';
import {
  ensureTestAccount,
  formatReport,
  TestAccountReport,
} from './test-accounts';

async function main(): Promise<number> {
  let options: ReturnType<typeof parseOptions>;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    return 2;
  }

  // Guardas 1, 2 e a do banco: só ambiente, antes de carregar a API.
  const environmentFailures = checkEnvironmentGuards(process.env);
  if (environmentFailures.length > 0) {
    console.error(describeGuardFailures(environmentFailures));
    return 1;
  }

  let settings: ReturnType<typeof readSettings>;
  try {
    settings = readSettings(process.env);
  } catch (error) {
    if (error instanceof TestAccountsUsageError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }

  // Só agora a API é carregada: num ambiente recusado, nem o código dela roda.
  const { openTestAccountsContext } = await import('./nest-context');
  const context = await openTestAccountsContext();

  try {
    // Guarda 3, metade Asaas: a configuração ativa mora no banco
    // (system_settings), com recaída no ASAAS_TOKEN do ambiente. Só leitura.
    const asaasFailures = checkAsaasGuard(await context.asaasConfig());
    if (asaasFailures.length > 0) {
      console.error(describeGuardFailures(asaasFailures));
      return 1;
    }

    const reports: TestAccountReport[] = [];
    for (const family of options.families) {
      for (const planType of options.plans) {
        console.log(`→ ${family}-${planType.toLowerCase()}`);
        reports.push(
          await ensureTestAccount(context.deps, {
            family,
            fixture: PLAN_FIXTURES[planType],
            emailDomain: settings.emailDomain,
            password: settings.password,
            mode: options.mode,
            dryRun: options.dryRun,
          }),
        );
      }
    }

    console.log('');
    console.log(
      formatReport(reports, {
        mode: options.mode,
        dryRun: options.dryRun,
        fixturesVersion: FIXTURES_VERSION,
        emailDomain: settings.emailDomain,
      }),
    );

    return reports.some((report) => report.errors.length > 0) ? 1 : 0;
  } finally {
    await context.close();
  }
}

if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
