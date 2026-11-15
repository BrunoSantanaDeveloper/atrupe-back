import {
  QuotationComposition,
  resolveCommercialQuantity,
} from './commercial-quantity.util';

/**
 * Valores de item de nota fiscal (NF-e e NFC-e), da linha do documento de
 * venda até o XML.
 *
 * No banco, em CENTAVOS: `totalValue` é o bruto da linha, `finalValue` o
 * líquido (já com o desconto ou o acréscimo) e `discount` guarda o desconto
 * como foi digitado — reais quando `discountType` é VALUE, percentual quando é
 * PERCENT, negativo quando é acréscimo. Por isso o desconto da nota sai da
 * diferença entre bruto e líquido, e nunca de `discount`: lido como reais, um
 * desconto de 10% virava R$ 0,10.
 *
 * Na nota, `vProd` (qCOM × vUnCom) é o bruto e o desconto vai só em `vDesc`,
 * porque a SEFAZ confere vNF = vProd − vDesc. Antes o valor unitário saía do
 * líquido e o desconto ainda era abatido outra vez: a nota cobrava menos que a
 * venda, e o cliente via "valores diferentes dos cadastrados".
 */

/** Menor qCOM aceito na emissão (`@Min` do item da NF-e e da NFC-e). */
const MENOR_QUANTIDADE = 0.001;

/**
 * Arredonda meio para cima em `casas` decimais. O `toPrecision` tira o ruído
 * binário antes (1,005 × 100 dá 100,49999…, e o `Math.round` puro erraria).
 */
export function arredondar(valor: number, casas: number): number {
  const fator = 10 ** casas;
  return Math.round(Number((valor * fator).toPrecision(15))) / fator;
}

/** Linha do documento (QuotationProduct) na forma em que o Prisma devolve. */
export interface LinhaDoDocumento {
  quantity?: number | null;
  totalValue?: number | null;
  finalValue?: number | null;
  items?: QuotationComposition[] | null;
}

export interface ValoresDaLinha {
  /** qCOM, já com as 4 casas que o leiaute leva. */
  quantity: number;
  /** uCOM. */
  unit: string;
  /** vUnCom em reais, sem arredondar: o XML leva 10 casas. */
  unitValue: number;
  /** vDesc em reais. Nunca negativo. */
  discount: number;
  /** Líquido da linha em reais: quantity × unitValue − discount. */
  totalValue: number;
  /**
   * A mesma linha contada em peças e, quando ela tem uma medida (área,
   * comprimento…), medida. A tela usa a razão entre as duas para converter a
   * quantidade quando o usuário troca a unidade do item: sem isso, trocar UN
   * por M2 só trocava o rótulo e "1 UN x R$ 530" virava "1 M2 x R$ 530".
   */
  pieceQuantity: number;
  measureQuantity?: number;
  measureUnit?: string;
}

/**
 * Quantidade, unidade e valores de uma linha do documento para a nota.
 *
 * - Desconto: bruto em `vProd`, a diferença para o líquido em `vDesc`.
 * - Acréscimo (líquido maior que o bruto): não há campo de item para ele no
 *   payload, então entra no valor unitário. A nota cobra o que foi vendido, e
 *   não sai `vDesc` negativo, que o schema recusa.
 * - Desconto de 100% (líquido zero) é desconto de verdade: vDesc = vProd.
 * - O valor unitário sai da quantidade JÁ arredondada para 4 casas: com a
 *   quantidade cheia, uma área como 0,123456 m² ia ao XML como 0,1235 e
 *   qCOM × vUnCom deixava de bater com `vProd`.
 *
 * `unidadeCadastrada` é a "Unidade comercial" do fiscal do produto; ver
 * `resolveCommercialQuantity`.
 */
export function valoresDaLinhaParaNota(
  linha: LinhaDoDocumento,
  unidadeCadastrada?: string | null,
): ValoresDaLinha {
  const brutoCentavos = Math.max(0, Math.round(linha.totalValue ?? 0));
  const liquidoCentavos = Math.max(
    0,
    Math.round(linha.finalValue ?? linha.totalValue ?? 0),
  );
  const valorCentavos = Math.max(brutoCentavos, liquidoCentavos);
  const descontoCentavos = valorCentavos - liquidoCentavos;

  let comercial = resolveCommercialQuantity(
    linha.quantity,
    linha.items,
    unidadeCadastrada,
  );
  let quantity = arredondar(comercial.quantity, 4);
  if (quantity < MENOR_QUANTIDADE) {
    // Medida pequena demais para qCOM: a nota conta as peças.
    comercial = resolveCommercialQuantity(linha.quantity, linha.items, '');
    quantity = arredondar(comercial.quantity, 4);
  }

  // Cadastro vazio conta peças; sem o argumento, a medida quando há uma.
  const pecas = resolveCommercialQuantity(linha.quantity, linha.items, '');
  const medida = resolveCommercialQuantity(linha.quantity, linha.items);
  const quantidadeMedida = arredondar(medida.quantity, 4);

  return {
    quantity,
    unit: comercial.unit,
    unitValue: quantity > 0 ? valorCentavos / 100 / quantity : 0,
    discount: descontoCentavos / 100,
    totalValue: liquidoCentavos / 100,
    pieceQuantity: arredondar(pecas.quantity, 4),
    ...(medida.unit !== 'UN' && quantidadeMedida >= MENOR_QUANTIDADE
      ? { measureQuantity: quantidadeMedida, measureUnit: medida.unit }
      : {}),
  };
}

/** Item como a tela manda para a emissão: quantidade e valores em reais. */
export interface ItemDaEmissao {
  quantity: number;
  unitValue: number;
  discount?: number | null;
}

export interface ValoresDoItemNoXml {
  /** qCOM com 4 casas. */
  quantidade: number;
  /** vProd com 2 casas. */
  valorProduto: number;
  /** vDesc com 2 casas; zero quando não há desconto. */
  desconto: number;
}

/**
 * Valores do item como vão ao XML. `vProd` sai da quantidade com 4 casas —
 * a mesma que vai em qCOM —, porque a SEFAZ confere vProd = qCOM × vUnCom; e os
 * totais somam os itens já arredondados, porque ela confere também cada total
 * com a soma dos itens.
 */
export function valoresDoItemNoXml(item: ItemDaEmissao): ValoresDoItemNoXml {
  const quantidade = arredondar(item.quantity, 4);
  return {
    quantidade,
    valorProduto: arredondar(quantidade * item.unitValue, 2),
    desconto: arredondar(item.discount || 0, 2),
  };
}

/** Item com frete e seguro, como a tela mostra o "Valor final" da linha. */
export interface ItemComAcessorios extends ItemDaEmissao {
  freight?: number | null;
  insurance?: number | null;
}

/**
 * Líquido da linha como a tela mostra: vProd − vDesc já arredondados, mais
 * frete e seguro. Com a conta sem arredondar, 2,5 x R$ 4,01 dava R$ 10,02
 * na linha e R$ 10,03 no total da nota.
 */
export function totalDoItemNaNota(item: ItemComAcessorios): number {
  const { valorProduto, desconto } = valoresDoItemNoXml(item);
  return arredondar(
    valorProduto - desconto + (item.freight || 0) + (item.insurance || 0),
    2,
  );
}

export interface TotaisDosItens {
  /** vProd do total: soma dos vProd dos itens. */
  valorProdutos: number;
  /** vDesc do total: soma dos vDesc dos itens. */
  valorDesconto: number;
  /** vNF sem frete, seguro e outros: produtos − desconto. */
  valorTotal: number;
}

export function totaisDosItens(itens: ItemDaEmissao[]): TotaisDosItens {
  let produtos = 0;
  let desconto = 0;
  for (const item of itens) {
    const valores = valoresDoItemNoXml(item);
    produtos += valores.valorProduto;
    desconto += valores.desconto;
  }
  const valorProdutos = arredondar(produtos, 2);
  const valorDesconto = arredondar(desconto, 2);
  return {
    valorProdutos,
    valorDesconto,
    valorTotal: arredondar(valorProdutos - valorDesconto, 2),
  };
}
