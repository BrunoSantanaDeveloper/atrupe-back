#!/usr/bin/env node
/**
 * Aplica o NCM padrão aos produtos sem NCM preenchido, em todos os clientes.
 *
 * Produtos criados pela tela ganham dados fiscais com NCM padrão desde que o
 * product.service passou a chamar getOrCreateWithDefaults na criação. Ficaram
 * para trás duas populações que hoje travam a emissão com "informe um NCM
 * válido":
 *   1. produto SEM registro ProductFiscalData — importação CSV cria o produto
 *      direto via Prisma e produtos antigos antecedem o default. A NF-e ainda
 *      preenche lazily no prepare, mas a NFC-e não;
 *   2. produto COM registro e ncm null/vazio — formulário salvo com o campo
 *      NCM limpo. Nenhum fluxo repara depois.
 *
 * Para (1) cria o registro com os mesmos defaults de getOrCreateWithDefaults
 * (product-fiscal.service.ts). Para (2) preenche SOMENTE o ncm, preservando o
 * restante configurado pelo usuário. O NCM padrão é resolvido por empresa:
 * InvoicyConfig isDefault → config mais antiga → fallback 49119900.
 *
 * Por padrão processa só empresas com a feature nota_fiscal ativa (plano ou
 * add-on da subscription, espelhando PlanControlService.getCompanyPlanInfo).
 *
 * É idempotente.
 *
 * Uso:
 *   npm run fiscal:ncm:dry            # relatório, não escreve
 *   npm run fiscal:ncm                # aplica
 *   ... -- --company=<id>             # só uma empresa (mesmo sem o módulo)
 *   ... -- --all                      # todas as empresas, com e sem o módulo
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { defaultsCadastroFiscal } from '../core/fiscal/utils/product-fiscal-defaults.util';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const DRY_RUN = process.argv.includes('--dry-run');
const ALL_COMPANIES = process.argv.includes('--all');
const ONLY_COMPANY = process.argv
  .find((arg) => arg.startsWith('--company='))
  ?.split('=')[1];

/** Mesmo fallback de getOrCreateWithDefaults (product-fiscal.service.ts). */
export const FALLBACK_NCM = '49119900';
export const FALLBACK_CFOP_IN_STATE = '5101';

/** Quantos produtos gravar por transação. */
const BATCH_SIZE = 200;

const NOTA_FISCAL_FEATURE = 'nota_fiscal';

export interface InvoicyConfigDefaults {
  isDefault: boolean;
  createdAt: Date;
  defaultNcm: string | null;
  defaultCfop: string | null;
  /** Regime do emissor; decide o CST de ICMS dos cadastros criados. */
  emitCrt?: number | null;
}

/** "Sem NCM preenchido" = null ou string vazia/só espaços. NCM inválido
 * (curto, genérico) foi preenchido de propósito e não é tocado aqui. */
export function needsNcm(ncm: string | null | undefined): boolean {
  return !ncm || ncm.trim() === '';
}

/**
 * Resolve o NCM/CFOP padrão da empresa espelhando getCompanyFiscalDefaults:
 * config isDefault → config mais antiga → fallback fixo.
 */
export function resolveCompanyDefaults(configs: InvoicyConfigDefaults[]): {
  ncm: string;
  cfopInState: string;
  emitCrt: number | null;
} {
  const byPreference =
    configs.find((c) => c.isDefault) ??
    [...configs].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    )[0];

  return {
    ncm: byPreference?.defaultNcm || FALLBACK_NCM,
    cfopInState: byPreference?.defaultCfop || FALLBACK_CFOP_IN_STATE,
    emitCrt: byPreference?.emitCrt ?? null,
  };
}

interface SubscriptionFeatures {
  plan: { planFeatures: { feature: { key: string } | null }[] };
  subscriptionFeatures: {
    isActive: boolean;
    feature: { key: string } | null;
  }[];
}

/**
 * Espelha PlanControlService.getCompanyPlanInfo: feature do plano (sem olhar
 * isActive do PlanFeature, como lá) ou add-on ativo da subscription.
 */
export function hasNotaFiscalFeature(
  subscriptions: SubscriptionFeatures[],
): boolean {
  return subscriptions.some(
    (sub) =>
      sub.plan.planFeatures.some(
        (pf) => pf.feature?.key === NOTA_FISCAL_FEATURE,
      ) ||
      sub.subscriptionFeatures.some(
        (sf) => sf.isActive && sf.feature?.key === NOTA_FISCAL_FEATURE,
      ),
  );
}

async function main() {
  const prisma = new PrismaClient();

  try {
    const companies = await prisma.company.findMany({
      where: ONLY_COMPANY ? { id: ONLY_COMPANY } : undefined,
      select: {
        id: true,
        name: true,
        Subscription: {
          where: { status: 'ACTIVE' },
          select: {
            plan: {
              select: {
                planFeatures: {
                  select: { feature: { select: { key: true } } },
                },
              },
            },
            subscriptionFeatures: {
              select: {
                isActive: true,
                feature: { select: { key: true } },
              },
            },
          },
        },
        invoicyConfigs: {
          select: {
            isDefault: true,
            createdAt: true,
            defaultNcm: true,
            defaultCfop: true,
            emitCrt: true,
          },
        },
      },
    });

    if (ONLY_COMPANY && companies.length === 0) {
      throw new Error(`Empresa ${ONLY_COMPANY} não encontrada.`);
    }

    const targets =
      ONLY_COMPANY || ALL_COMPANIES
        ? companies
        : companies.filter((c) => hasNotaFiscalFeature(c.Subscription));

    console.log(
      `${companies.length} empresas; ${targets.length} no escopo` +
        `${ONLY_COMPANY ? ' (--company)' : ALL_COMPANIES ? ' (--all)' : ' (com feature nota_fiscal)'}.`,
    );

    let totalCreate = 0;
    let totalUpdate = 0;

    for (const company of targets) {
      const defaults = resolveCompanyDefaults(company.invoicyConfigs);

      const products = await prisma.product.findMany({
        where: {
          companyId: company.id,
          OR: [
            { fiscalData: null },
            { fiscalData: { OR: [{ ncm: null }, { ncm: '' }] } },
          ],
        },
        select: {
          id: true,
          name: true,
          fiscalData: { select: { id: true, ncm: true } },
        },
      });

      // O where já filtra; needsNcm é o cinto de segurança para não
      // sobrescrever um NCM que exista (ex.: só espaços não entra no filtro).
      const toCreate = products.filter((p) => !p.fiscalData);
      const toUpdate = products.filter(
        (p) => p.fiscalData && needsNcm(p.fiscalData.ncm),
      );

      if (toCreate.length === 0 && toUpdate.length === 0) continue;

      totalCreate += toCreate.length;
      totalUpdate += toUpdate.length;

      console.log(
        `\n[${company.id}] ${company.name}: NCM padrão ${defaults.ncm} — ` +
          `${toCreate.length} sem cadastro fiscal, ${toUpdate.length} com NCM vazio.`,
      );

      if (DRY_RUN) continue;

      // Mesmos defaults de getOrCreateWithDefaults, para o backfill e o
      // preenchimento lazy da NF-e produzirem registros idênticos.
      const createOps = toCreate.map((product) =>
        prisma.productFiscalData.create({
          data: {
            product: { connect: { id: product.id } },
            ncm: defaults.ncm,
            cfopInState: defaults.cfopInState,
            ...defaultsCadastroFiscal(defaults.emitCrt),
          },
        }),
      );

      const updateOps = toUpdate.map((product) =>
        prisma.productFiscalData.update({
          where: { id: product.fiscalData!.id },
          data: { ncm: defaults.ncm },
        }),
      );

      const ops = [...createOps, ...updateOps];
      for (let i = 0; i < ops.length; i += BATCH_SIZE) {
        await prisma.$transaction(ops.slice(i, i + BATCH_SIZE));
        console.log(
          `  Gravados ${Math.min(i + BATCH_SIZE, ops.length)}/${ops.length}`,
        );
      }
    }

    console.log(
      `\n${DRY_RUN ? 'DRY RUN — nenhuma alteração gravada. Seriam' : 'Concluído:'} ` +
        `${totalCreate} cadastros fiscais criados e ${totalUpdate} NCMs preenchidos.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
