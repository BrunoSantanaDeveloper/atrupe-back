/**
 * As produções (PS-1, a pergunta "O que a sua empresa produz?"): o que um
 * setor produz (Maicol, 23/11/2026). A empresa cria os setores e liga as
 * produções à mão; não há regra, porque depende de como ela quer controlar
 * (ex.: acabamento e instalação com a mesma equipe, separados para saber o
 * que é dentro e o que é fora). A lista cresce com o tempo; a tela tem a
 * mesma (src/consts/productions.ts).
 */
export const PRODUCTIONS = [
  'impressao_solvente',
  'impressao_uv',
  'sublimacao',
  'recorte',
  'serigrafia',
  'serralheria',
  'marcenaria',
  'brindes',
  'grafica_rapida',
  'offset',
  'locacao',
] as const;

export type Production = (typeof PRODUCTIONS)[number];
