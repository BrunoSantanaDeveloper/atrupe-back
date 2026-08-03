/**
 * Censo pré-deploy da Fase 0 da centralização fiscal.
 *
 * Somente leitura — não altera nada. Rode em produção ANTES de publicar a
 * Fase 0, porque duas mudanças dela falham fechada e podem bloquear emissões
 * que hoje passam:
 *
 *   1. `assertFiscalItemsReady` na NF-e rejeita item sem NCM de 8 dígitos ou
 *      sem CFOP de 4 dígitos. O seed do onboarding grava NCM '00000000',
 *      então empresas seedadas e nunca revisadas param de emitir.
 *   2. `getUfCode` deixa de cair em RS (43) para UF desconhecida e lança.
 *
 * Também reporta empresas com 0 ou 2+ emissores marcados como padrão, o que
 * bloqueia o índice único parcial previsto para a Fase 3.
 *
 * Uso: npx ts-node scripts/fiscal-phase0-census.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const UF_VALIDAS = new Set([
  'RO',
  'AC',
  'AM',
  'RR',
  'PA',
  'AP',
  'TO',
  'MA',
  'PI',
  'CE',
  'RN',
  'PB',
  'PE',
  'AL',
  'SE',
  'BA',
  'MG',
  'ES',
  'RJ',
  'SP',
  'PR',
  'SC',
  'RS',
  'MS',
  'MT',
  'GO',
  'DF',
]);

async function censoIsDefault() {
  const rows = await prisma.$queryRaw<
    { companyId: string; total: bigint; defaults: bigint }[]
  >`
    SELECT "companyId",
           count(*)                                    AS total,
           count(*) FILTER (WHERE "isDefault")         AS defaults
    FROM invoicy_configs
    GROUP BY "companyId"
    HAVING count(*) FILTER (WHERE "isDefault") <> 1
    ORDER BY count(*) FILTER (WHERE "isDefault") ASC
  `;

  console.log(`\n=== Emissores padrão fora do esperado (${rows.length}) ===`);
  if (rows.length === 0) {
    console.log('OK — toda empresa tem exatamente um emissor padrão.');
    return;
  }
  for (const r of rows) {
    console.log(
      `  company=${r.companyId}  emissores=${r.total}  padrão=${r.defaults}` +
        (Number(r.defaults) === 0 ? '  <- NENHUM PADRÃO' : '  <- MÚLTIPLOS'),
    );
  }
}

async function censoUfEmitente() {
  const companies = await prisma.company.findMany({
    where: { invoicyConfigs: { some: {} } },
    select: {
      id: true,
      name: true,
      address: { select: { type: true, state: true } },
    },
  });

  const problemas = companies.filter((c) => {
    const addr = c.address.find((a) => a.type === 'Principal') ?? c.address[0];
    const uf = addr?.state?.toUpperCase();
    return !uf || !UF_VALIDAS.has(uf);
  });

  console.log(
    `\n=== Empresas com UF do emitente inválida (${problemas.length}) ===`,
  );
  if (problemas.length === 0) {
    console.log('OK — todas as empresas com emissor têm UF válida.');
    return;
  }
  console.log('Estas empresas vão parar de emitir (getUfCode falha fechada):');
  for (const c of problemas) {
    const addr = c.address.find((a) => a.type === 'Principal') ?? c.address[0];
    console.log(
      `  ${c.id}  ${c.name}  UF="${addr?.state ?? '(sem endereço)'}"`,
    );
  }
}

async function censoDadosFiscaisProduto() {
  const rows = await prisma.$queryRaw<
    { companyId: string; nome: string; produtos: bigint; motivo: string }[]
  >`
    SELECT p."companyId",
           c.name AS nome,
           count(*) AS produtos,
           CASE
             WHEN pf.id IS NULL THEN 'sem dados fiscais'
             WHEN pf.ncm IS NULL OR pf.ncm = '' THEN 'NCM ausente'
             WHEN regexp_replace(pf.ncm, '\\D', '', 'g') = '00000000' THEN 'NCM 00000000 (seed)'
             WHEN length(regexp_replace(pf.ncm, '\\D', '', 'g')) <> 8 THEN 'NCM com tamanho inválido'
             ELSE 'outro'
           END AS motivo
    FROM products p
    JOIN companies c ON c.id = p."companyId"
    LEFT JOIN product_fiscal_data pf ON pf."productId" = p.id
    WHERE pf.id IS NULL
       OR pf.ncm IS NULL
       OR pf.ncm = ''
       OR length(regexp_replace(pf.ncm, '\\D', '', 'g')) <> 8
       OR regexp_replace(pf.ncm, '\\D', '', 'g') = '00000000'
    GROUP BY p."companyId", c.name, motivo
    ORDER BY count(*) DESC
  `;

  console.log(
    `\n=== Produtos que bloqueariam emissão de NF-e (${rows.length} grupos) ===`,
  );
  if (rows.length === 0) {
    console.log('OK — nenhum produto com NCM inválido.');
    return;
  }
  console.log('Corrija ANTES do deploy, ou a NF-e destas empresas para:');
  let total = 0n;
  for (const r of rows) {
    total += r.produtos;
    console.log(
      `  ${r.nome} (${r.companyId})  ${r.produtos} produto(s)  — ${r.motivo}`,
    );
  }
  console.log(`\n  TOTAL: ${total} produto(s) afetado(s).`);
}

async function main() {
  console.log('Censo pré-deploy — Fase 0 da centralização fiscal');
  console.log('Somente leitura; nada é alterado.\n');

  await censoIsDefault();
  await censoUfEmitente();
  await censoDadosFiscaisProduto();

  console.log('\nCenso concluído.');
}

main()
  .catch((e) => {
    console.error('Falha no censo:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
