import { PrismaClient } from '@prisma/client';
import type { UnitKind } from '@prisma/client';
import {
  importedItemPrices,
  rawToDisplayUnitCost,
} from '../core/import/product-unit';

/**
 * Devolve o preço aos produtos estragados pelo "Salvar no produto" antigo da
 * nota fiscal (até 15/11/2026).
 *
 * O botão gravava em TODOS os itens do produto `unitCost = salePrice =` valor
 * unitário da nota EM REAIS. Num item por área isso vira uma taxa de R$/mm²
 * (R$ 530 virava R$ 5,3 milhões por m²); num item por unidade, reais lidos
 * como centavos (R$ 45 virava R$ 0,45). Também zerava as etapas de produção,
 * que não têm como voltar.
 *
 * Como achar o estrago: o diálogo fazia GET /product/:id, PATCH /product/:id
 * e POST /fiscal/product/upsert em sequência automática, SEM nenhuma outra
 * requisição do usuário entre o GET e o PATCH. A tela de produtos faz o
 * mesmo PATCH + upsert, mas carrega o fiscal (GET /fiscal/product/:id) entre
 * um e outro — é o que separa os dois. Produto gravado de novo pela tela de
 * produtos depois do último evento fica como está.
 *
 * Preço proposto: o das O.S. feitas antes do primeiro evento, na mesma
 * unidade do item. Confiança alta quando o valor digitado na nota é um preço
 * do histórico, ou quando um preço domina (3 linhas ou mais e o dobro do
 * segundo). O resto é decisão de quem conhece a conta.
 *
 * Sem --yes só relata. Com --yes grava apenas o que foi aceito:
 *   --aceitar=altas            aceita as propostas de confiança alta
 *   --aceitar=<item>,<item>    aceita a proposta destes itens
 *   --preco=<item>=<reais>     grava este preço (por m², por un…) no item
 * Cada item gravado sai no log com o valor de antes, para desfazer.
 *
 * Uso:
 *   npm run produtos:salvar-no-produto:dev -- --company-id=<id> [opções]
 *   npm run produtos:salvar-no-produto -- --company-id=<id> [opções]  (contêiner)
 */

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** Unidade de exibição de cada tipo, para o relatório. */
const UNIDADE_DE_EXIBICAO: Record<string, string> = {
  AREA: 'm²',
  LENGTH: 'm',
  CAPACITY: 'L',
  WEIGHT: 'kg',
  DISTANCE: 'km',
  DURATION: 'h',
  UNITY: 'un',
};

export interface LinhaDoHistorico {
  unitCost: number;
  createdAt: Date;
}

/** Um preço do histórico, por unidade de exibição, em centavos. */
export interface GrupoDePreco {
  centavos: number;
  linhas: number;
  ultima: Date;
}

export interface Proposta {
  centavos: number | null;
  confianca: 'alta' | 'baixa' | 'sem-historico';
  motivo: string;
}

/**
 * Preços das O.S. por unidade de exibição, arredondados ao centavo: taxas
 * que só diferem no ruído (0,023 e 0,02300014 R$/mm²) contam juntas. Mais
 * usado primeiro; no empate, o mais recente.
 */
export function agruparHistorico(
  linhas: LinhaDoHistorico[],
  kind: UnitKind | null,
): GrupoDePreco[] {
  const grupos = new Map<number, GrupoDePreco>();
  for (const linha of linhas) {
    const exibicao = rawToDisplayUnitCost(linha.unitCost, kind);
    if (!exibicao || exibicao <= 0) continue;
    const centavos = Math.round(exibicao);
    const grupo = grupos.get(centavos);
    if (!grupo) {
      grupos.set(centavos, {
        centavos,
        linhas: 1,
        ultima: linha.createdAt,
      });
    } else {
      grupo.linhas += 1;
      if (linha.createdAt > grupo.ultima) grupo.ultima = linha.createdAt;
    }
  }
  return [...grupos.values()].sort(
    (a, b) => b.linhas - a.linhas || b.ultima.getTime() - a.ultima.getTime(),
  );
}

/**
 * Preço a devolver ao item.
 *
 * `valorGravado` é o número que o botão gravou: o valor digitado na nota, em
 * reais por unidade de exibição. Quando ele é um preço do histórico, era o
 * preço do produto e o problema foi só a escala.
 */
export function proporPreco(
  valorGravado: number,
  grupos: GrupoDePreco[],
): Proposta {
  const digitado = Math.round(valorGravado * 100);
  const igual = grupos.find((grupo) => grupo.centavos === digitado);
  if (igual) {
    return {
      centavos: igual.centavos,
      confianca: 'alta',
      motivo: 'o valor digitado na nota é um preço das O.S.',
    };
  }

  const [primeiro, segundo] = grupos;
  if (!primeiro) {
    return {
      centavos: null,
      confianca: 'sem-historico',
      motivo: 'nenhuma O.S. antes do estrago',
    };
  }

  if (
    primeiro.linhas >= 3 &&
    (!segundo || primeiro.linhas >= 2 * segundo.linhas)
  ) {
    return {
      centavos: primeiro.centavos,
      confianca: 'alta',
      motivo: `preço de ${primeiro.linhas} linhas de O.S.`,
    };
  }

  return {
    centavos: primeiro.centavos,
    confianca: 'baixa',
    motivo: 'histórico dividido: conferir com o cliente',
  };
}

export interface ItemDoProduto {
  id: string;
  unitKind: UnitKind | null;
  unitCost: number | null;
  salePrice: number | null;
  width: number | null;
  height: number | null;
  duration: number | null;
}

/**
 * O item ainda está como o botão o deixou: custo e preço iguais. Item por
 * medida gravado pela tela tem preço = taxa x medida (ou nenhum), e item por
 * unidade regravado com o mesmo número não é estrago a desfazer.
 */
export function comoOBotaoDeixou(item: ItemDoProduto): boolean {
  return (
    item.unitCost !== null &&
    item.unitCost > 0 &&
    item.salePrice !== null &&
    item.unitCost === item.salePrice
  );
}

/** Custo e preço do item para um preço por unidade de exibição. */
export function precosDoItem(
  item: ItemDoProduto,
  centavosPorUnidade: number,
): { unitCost: number | null; salePrice: number | null } {
  return importedItemPrices(centavosPorUnidade, item.unitKind, {
    widthMm: item.width,
    heightMm: item.height,
    durationSeconds: item.duration,
  });
}

/** "120", "120,50" ou "1.234,56" em centavos. */
export function reaisEmCentavos(texto: string): number | null {
  const limpo = texto.trim().replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(limpo)) return null;
  return Math.round(Number(limpo) * 100);
}

function reais(centavos: number | null): string {
  if (centavos === null) return '—';
  return (centavos / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

interface EventoDoBotao {
  productId: string;
  primeiro: Date;
  ultimo: Date;
  vezes: number;
}

/** Eventos do "Salvar no produto" antigo na conta (ver o cabeçalho). */
async function eventosDoBotao(
  prisma: PrismaClient,
  companyId: string,
): Promise<EventoDoBotao[]> {
  return prisma.$queryRawUnsafe<EventoDoBotao[]>(
    `
    WITH ev AS (
      SELECT "userId", method, "createdAt",
             regexp_replace(endpoint, '[?].*$', '') AS ep
        FROM user_activity_events
       WHERE "companyId" = $1
         AND method IN ('GET', 'PATCH', 'POST')
         AND (endpoint LIKE '/product/%' OR endpoint LIKE '%/fiscal/product/upsert%')
    ), seq AS (
      SELECT *,
             lag(method) OVER w AS m_ant, lag(ep) OVER w AS ep_ant,
             lag("createdAt") OVER w AS t_ant,
             lead(method) OVER w AS m_prox, lead(ep) OVER w AS ep_prox,
             lead("createdAt") OVER w AS t_prox
        FROM ev
      WINDOW w AS (PARTITION BY "userId" ORDER BY "createdAt")
    )
    SELECT split_part(s.ep, '/', 3) AS "productId",
           MIN(s."createdAt") AS primeiro, MAX(s."createdAt") AS ultimo,
           COUNT(*)::int AS vezes
      FROM seq s
     WHERE s.method = 'PATCH' AND s.ep ~ '^/product/${UUID}$'
       AND s.m_ant = 'GET' AND s.ep_ant = s.ep
       AND s."createdAt" - s.t_ant < interval '3 seconds'
       AND s.m_prox = 'POST' AND s.ep_prox LIKE '%/fiscal/product/upsert%'
       AND s.t_prox - s."createdAt" < interval '5 seconds'
       AND NOT EXISTS (
         SELECT 1 FROM user_activity_events x
          WHERE x."userId" = s."userId"
            AND x."createdAt" > s.t_ant AND x."createdAt" < s."createdAt")
     GROUP BY 1`,
    companyId,
  );
}

/** Produto regravado (pela tela de produtos) depois do último evento. */
async function regravadoDepois(
  prisma: PrismaClient,
  companyId: string,
  productId: string,
  depoisDe: Date,
): Promise<boolean> {
  const [{ n }] = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT COUNT(*)::int AS n FROM user_activity_events
      WHERE "companyId" = $1 AND method = 'PATCH'
        AND regexp_replace(endpoint, '[?].*$', '') = $2
        AND "createdAt" > $3`,
    companyId,
    `/product/${productId}`,
    new Date(depoisDe.getTime() + 1000),
  );
  return n > 0;
}

async function historicoDoItem(
  prisma: PrismaClient,
  item: ItemDoProduto,
  antesDe: Date,
): Promise<LinhaDoHistorico[]> {
  return prisma.quotationProductItem.findMany({
    where: {
      productItemId: item.id,
      unitKind: item.unitKind,
      createdAt: { lt: antesDe },
      unitCost: { not: null },
    },
    select: { unitCost: true, createdAt: true },
  }) as Promise<LinhaDoHistorico[]>;
}

interface Plano {
  produto: { id: string; code: string; name: string; etapas: number };
  item: ItemDoProduto;
  vezes: number;
  primeiro: Date;
  grupos: GrupoDePreco[];
  proposta: Proposta;
}

function flagValues(args: string[], nome: string): string[] {
  return args
    .filter((a) => a.startsWith(`--${nome}=`))
    .map((a) => a.slice(nome.length + 3));
}

async function main() {
  const args = process.argv.slice(2);
  const gravar = args.includes('--yes');
  const [companyId] = flagValues(args, 'company-id');
  const aceitos = flagValues(args, 'aceitar').flatMap((v) => v.split(','));
  const precosManuais = new Map<string, number>();
  for (const valor of flagValues(args, 'preco')) {
    const [itemId, texto] = valor.split('=');
    const centavos = texto ? reaisEmCentavos(texto) : null;
    if (!itemId || centavos === null || centavos <= 0) {
      console.error(`--preco inválido: '${valor}'. Use --preco=<item>=<reais>`);
      process.exit(1);
    }
    precosManuais.set(itemId, centavos);
  }

  if (!companyId) {
    console.error(
      'Uso: repair-nfe-saved-product-prices --company-id=<id> [--aceitar=altas|<item>,…] [--preco=<item>=<reais>] [--yes]',
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true },
    });
    if (!company) throw new Error(`Empresa ${companyId} não encontrada`);
    console.log(`Empresa: ${company.name} (${company.id})`);
    console.log(
      gravar
        ? 'Modo:    gravando o que foi aceito\n'
        : 'Modo:    simulação (use --yes com --aceitar/--preco para gravar)\n',
    );

    const planos: Plano[] = [];
    for (const evento of await eventosDoBotao(prisma, company.id)) {
      const produto = await prisma.product.findFirst({
        where: { id: evento.productId, companyId: company.id },
        select: {
          id: true,
          code: true,
          name: true,
          productionStages: true,
          items: {
            select: {
              id: true,
              unitKind: true,
              unitCost: true,
              salePrice: true,
              width: true,
              height: true,
              duration: true,
            },
          },
        },
      });
      if (!produto) continue;
      if (
        await regravadoDepois(prisma, company.id, produto.id, evento.ultimo)
      ) {
        console.log(
          `- ${produto.code} ${produto.name}: regravado pela tela de produtos depois; fica como está`,
        );
        continue;
      }
      for (const item of produto.items) {
        if (!comoOBotaoDeixou(item)) continue;
        const grupos = agruparHistorico(
          await historicoDoItem(prisma, item, evento.primeiro),
          item.unitKind,
        );
        planos.push({
          produto: {
            id: produto.id,
            code: produto.code,
            name: produto.name,
            etapas: Array.isArray(produto.productionStages)
              ? produto.productionStages.length
              : 0,
          },
          item,
          vezes: evento.vezes,
          primeiro: evento.primeiro,
          grupos,
          proposta: proporPreco(item.unitCost as number, grupos),
        });
      }
    }

    if (!planos.length) {
      console.log('Nenhum item estragado pelo botão nesta conta.');
      return;
    }

    planos.forEach((plano, indice) => {
      const unidade = UNIDADE_DE_EXIBICAO[plano.item.unitKind || 'UNITY'];
      const hoje = rawToDisplayUnitCost(
        plano.item.unitCost,
        plano.item.unitKind,
      );
      console.log(
        `[${indice + 1}] ${plano.produto.code} ${plano.produto.name} (${plano.item.unitKind || 'UNITY'})`,
      );
      console.log(`    item:      ${plano.item.id}`);
      console.log(
        `    hoje:      R$ ${reais(hoje === null ? null : Math.round(hoje))}/${unidade} (o botão gravou ${plano.item.unitCost} — R$ ${reais(Math.round((plano.item.unitCost as number) * 100))} digitados na nota) em ${plano.primeiro.toISOString().slice(0, 16)}, ${plano.vezes}x`,
      );
      console.log(
        `    proposta:  ${plano.proposta.centavos === null ? '—' : `R$ ${reais(plano.proposta.centavos)}/${unidade}`} [${plano.proposta.confianca}] ${plano.proposta.motivo}`,
      );
      console.log(
        `    O.S.:      ${
          plano.grupos
            .slice(0, 4)
            .map(
              (g) =>
                `R$ ${reais(g.centavos)} x${g.linhas} (última ${g.ultima.toISOString().slice(0, 10)})`,
            )
            .join('; ') || 'nenhuma'
        }`,
      );
      if (!plano.produto.etapas) {
        console.log('    etapas:    nenhuma (o botão apagava; conferir)');
      }
    });

    if (!gravar) {
      console.log('\nNada foi gravado.');
      return;
    }

    let gravados = 0;
    for (const plano of planos) {
      const manual = precosManuais.get(plano.item.id);
      const aceito =
        aceitos.includes(plano.item.id) ||
        (aceitos.includes('altas') && plano.proposta.confianca === 'alta');
      const centavos =
        manual ?? (aceito ? plano.proposta.centavos : null) ?? null;
      if (centavos === null) continue;

      const novos = precosDoItem(plano.item, centavos);
      // Só se o item não mudou desde a leitura.
      const { count } = await prisma.productItem.updateMany({
        where: {
          id: plano.item.id,
          productId: plano.produto.id,
          unitCost: plano.item.unitCost,
          salePrice: plano.item.salePrice,
        },
        data: novos,
      });
      if (!count) {
        console.log(`! ${plano.item.id}: mudou desde a leitura; não gravado`);
        continue;
      }
      gravados += 1;
      console.log(
        `ANTES  ${JSON.stringify({ itemId: plano.item.id, unitCost: plano.item.unitCost, salePrice: plano.item.salePrice })}`,
      );
      console.log(
        `DEPOIS ${JSON.stringify({ itemId: plano.item.id, ...novos })}`,
      );
    }
    console.log(`\n${gravados} item(ns) gravado(s).`);
  } catch (error: any) {
    console.error(`\nFalhou: ${error.message}`);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main();
}
