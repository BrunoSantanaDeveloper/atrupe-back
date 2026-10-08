/**
 * Relatório de produtos vendidos: uma linha por produto e unidade comercial.
 *
 * O mesmo produto pode sair como peça medida (m², m, kg…) numa venda e como
 * unidade montada em outra. Somar as duas não significaria nada, então cada
 * combinação produto + unidade vira uma linha.
 */
export interface ProductSoldItem {
  productId: string;
  name: string;
  quantity: number;
  /** Unidade comercial, a mesma que vai na NF-e: M2, UN, M, KG… */
  unit: string;
  value: number;
}

export interface ProductsSoldResponse {
  products: ProductSoldItem[];
  totalValue: number;
}
