import { BASE_PRODUCTS } from '../../seeds/products-base';

/**
 * Produtos de exemplo que toda conta nova recebe (`BASE_PRODUCTS`).
 *
 * Numa conta criada só para receber a migração eles não são do cliente: a
 * carga os adotava por nome ou por código no lugar do produto do legado, com o
 * preço de exemplo. Na Terabyte, o "Banner" de R$ 100,00 apareceu ao lado do
 * "BANNER" do legado, e o código ADREC do exemplo impediu a carga de criar o
 * "Adesivo Jateado + Recortes".
 */

const collator = new Intl.Collator('pt-BR', {
  sensitivity: 'base',
  usage: 'search',
});

const squash = (value: string | null | undefined) =>
  (value ?? '').replace(/\s+/g, ' ').trim();

const SEED_CODES = BASE_PRODUCTS.map((product) => squash(product.codigo));
const SEED_NAMES = BASE_PRODUCTS.map((product) => squash(product.nome));

const sameText = (a: string, b: string) => collator.compare(a, b) === 0;

export interface ExampleCandidate {
  isStandard: boolean;
  code: string;
  name: string;
}

/**
 * É produto de exemplo, mesmo depois de editado. Editar pela tela desliga
 * `isStandard`, e o código ou o nome ficam como vieram: na Terabyte o
 * "Banner" teve o código trocado e manteve o nome.
 */
export function isExampleProduct(product: ExampleCandidate): boolean {
  if (product.isStandard) return true;

  const code = squash(product.code);
  const name = squash(product.name);

  return (
    SEED_CODES.some((seed) => sameText(seed, code)) ||
    SEED_NAMES.some((seed) => sameText(seed, name))
  );
}

/**
 * Código livre para o exemplo que ocupa o código de um produto do legado.
 * O código é único por empresa, inclusive entre os inativos.
 */
export function exampleCodeFor(code: string, taken: Set<string>): string {
  const base = `${squash(code)}-EXEMPLO`;
  let candidate = base;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) {
    candidate = `${base}-${n}`;
  }
  return candidate;
}
