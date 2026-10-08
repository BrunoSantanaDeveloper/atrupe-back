#!/usr/bin/env node
/**
 * Inativa a cópia sobrando dos produtos que a migração duplicou.
 *
 * O importador casa produto por `legacyId` e por `code`, e o código que vem do
 * legado é gerado por `PRODUCT_CODE_SQL` (src/scripts/legacy-extractors.ts):
 * vale `cod` quando ele é único na base legada e `cod-idproduto` quando repete.
 * Esse código muda entre extrações. Quando uma conta recebeu uma 2ª carga com o
 * código já mudado e a cópia da 1ª não tinha `legacyId`, nada casou e o produto
 * nasceu de novo — "FACHADA ACM" ficou como `ACM` e como `ACM-34`.
 *
 * Inativa em vez de apagar: as duas cópias costumam ter histórico e
 * `QuotationProductItem` aponta para o produto E para o item dele, então apagar
 * exigiria repontar orçamento antigo. Inativar tira o duplicado da listagem e
 * das novas vendas, preserva o passado e se desfaz com um UPDATE.
 *
 * Só mexe no grupo com a ASSINATURA DA MIGRAÇÃO: mesmo nome, uma cópia com
 * `legacyId` e outra sem. Duplicata que o cliente cadastrou à mão (nenhuma com
 * `legacyId`) fica intocada — eram 27 das 30 contas com nome repetido.
 *
 * E pula o grupo em que duas cópias têm `legacyId` próprio e distinto: são
 * produtos DIFERENTES do legado que compartilham nome (um mesmo `cod` cobrindo
 * quatro tamanhos de Wind Banner, por exemplo), exatamente o que
 * `PRODUCT_CODE_SQL` existe para separar. Esses saem listados para conferência
 * humana em vez de serem inativados.
 *
 * Sobrevive a cópia mais usada em orçamentos; no empate fica a que tem
 * `legacyId`, para a recarga continuar casando nela.
 *
 * É idempotente.
 *
 * Sem `--apply` ele só relata — é o padrão de propósito, porque inativar
 * produto some com item da listagem do cliente.
 *
 * Uso:
 *   npm run produtos:dedup:dev                                 # relata tudo
 *   npm run produtos:dedup:dev -- --company=<id>               # relata uma empresa
 *   npm run produtos:dedup:dev -- --company=<id> --apply       # aplica naquela empresa
 *   ... --keep=<productId>,<productId>                         # força o sobrevivente
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const APPLY = process.argv.includes('--apply');
const ONLY_COMPANY = process.argv
  .find((arg) => arg.startsWith('--company='))
  ?.split('=')[1];
const FORCED_KEEP = new Set(
  (process.argv.find((arg) => arg.startsWith('--keep='))?.split('=')[1] || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
);

/** Quantos produtos inativar por lote. */
const BATCH_SIZE = 200;

export interface DuplicateCandidate {
  id: string;
  name: string;
  code: string;
  legacyId: string | null;
  isActive: boolean;
  usos: number;
}

/** Nome comparável: sem acento, sem caixa, sem espaço repetido. */
export function normalizeName(name: string | null | undefined): string {
  return (name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Assinatura da migração: o grupo tem cópia com `legacyId` e cópia sem. Sem
 * essa mistura, o nome repetido é cadastro do próprio cliente.
 */
export function hasMigrationSignature(group: DuplicateCandidate[]): boolean {
  return (
    group.length > 1 &&
    group.some((product) => product.legacyId) &&
    group.some((product) => !product.legacyId)
  );
}

/**
 * Duas cópias com vínculo próprio e distinto são produtos diferentes do
 * legado que só compartilham o nome. Inativar um deles apagaria da listagem um
 * produto legítimo, então o grupo vai para conferência humana.
 */
export function hasAmbiguousLegacyLinks(group: DuplicateCandidate[]): boolean {
  const links = new Set(
    group.map((product) => product.legacyId).filter(Boolean) as string[],
  );
  return links.size > 1;
}

/**
 * Sobrevivente: o mais usado em orçamentos; no empate, o que tem `legacyId`
 * (a recarga casa por ele e não cria outra cópia).
 */
export function pickSurvivor(
  group: DuplicateCandidate[],
  forcedKeep: Set<string> = new Set(),
): DuplicateCandidate {
  const forced = group.find((product) => forcedKeep.has(product.id));
  if (forced) return forced;

  return [...group].sort((a, b) => {
    if (b.usos !== a.usos) return b.usos - a.usos;
    if (!!b.legacyId !== !!a.legacyId) return b.legacyId ? 1 : -1;
    return a.id.localeCompare(b.id);
  })[0];
}

async function main() {
  const prisma = new PrismaClient();

  try {
    const companies = await prisma.company.findMany({
      where: ONLY_COMPANY ? { id: ONLY_COMPANY } : undefined,
      select: { id: true, name: true },
    });

    if (ONLY_COMPANY && companies.length === 0) {
      throw new Error(`Empresa ${ONLY_COMPANY} não encontrada.`);
    }

    const aInativar: string[] = [];
    const paraConferir: string[] = [];

    for (const company of companies) {
      const products = await prisma.product.findMany({
        where: { companyId: company.id },
        select: {
          id: true,
          name: true,
          code: true,
          legacyId: true,
          isActive: true,
        },
      });
      if (products.length === 0) continue;

      const grupos = new Map<string, typeof products>();
      for (const product of products) {
        const key = normalizeName(product.name);
        if (!grupos.has(key)) grupos.set(key, []);
        grupos.get(key)!.push(product);
      }

      const duplicados = [...grupos.entries()].filter(
        ([, group]) => group.length > 1,
      );
      if (duplicados.length === 0) continue;

      // Uso em orçamentos decide quem fica; uma consulta por empresa.
      const ids = duplicados.flatMap(([, group]) => group.map((p) => p.id));
      const usoRows = await prisma.quotationProduct.groupBy({
        by: ['productId'],
        where: { productId: { in: ids } },
        _count: { _all: true },
      });
      const usos = new Map(
        usoRows.map((row) => [row.productId, row._count._all]),
      );

      const linhas: string[] = [];

      for (const [nome, group] of duplicados) {
        const candidatos: DuplicateCandidate[] = group.map((product) => ({
          ...product,
          usos: usos.get(product.id) || 0,
        }));

        if (!hasMigrationSignature(candidatos)) continue;

        if (hasAmbiguousLegacyLinks(candidatos)) {
          paraConferir.push(
            `${company.name} | ${nome} | ${candidatos
              .map((p) => `${p.code}(${p.legacyId ?? '-'}, ${p.usos} usos)`)
              .join(' x ')}`,
          );
          continue;
        }

        const survivor = pickSurvivor(candidatos, FORCED_KEEP);
        const perdedores = candidatos.filter(
          (product) => product.id !== survivor.id && product.isActive,
        );
        if (perdedores.length === 0) continue;

        linhas.push(
          `  ${nome}\n` +
            `    fica   code=${survivor.code} legacyId=${survivor.legacyId ?? '-'} usos=${survivor.usos}\n` +
            perdedores
              .map(
                (p) =>
                  `    inativa code=${p.code} legacyId=${p.legacyId ?? '-'} usos=${p.usos} (${p.id})`,
              )
              .join('\n'),
        );

        aInativar.push(...perdedores.map((p) => p.id));
      }

      if (linhas.length > 0) {
        console.log(`\n[${company.id}] ${company.name}`);
        console.log(linhas.join('\n'));
      }
    }

    if (paraConferir.length > 0) {
      console.log(
        `\n${paraConferir.length} grupo(s) com vínculos distintos do legado — ` +
          `produtos diferentes de mesmo nome, NÃO tocados:`,
      );
      paraConferir.forEach((linha) => console.log(`  ${linha}`));
    }

    console.log(`\n${aInativar.length} produto(s) duplicado(s) a inativar.`);

    if (!APPLY) {
      console.log('DRY RUN — nada gravado. Use --apply para aplicar.');
      return;
    }

    for (let i = 0; i < aInativar.length; i += BATCH_SIZE) {
      const lote = aInativar.slice(i, i + BATCH_SIZE);
      await prisma.product.updateMany({
        where: { id: { in: lote } },
        data: { isActive: false },
      });
      console.log(
        `Gravados ${Math.min(i + BATCH_SIZE, aInativar.length)}/${aInativar.length}`,
      );
    }

    console.log('Concluído.');
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
