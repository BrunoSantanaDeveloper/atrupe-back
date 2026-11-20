/**
 * A NFC-e da venda recebida na frente de caixa (pedido do Maicol, 20/11/2026).
 *
 * A frente de caixa não identifica o cliente: emite NFC-e, sempre à mão, pelo
 * CNPJ cadastrado, com o CPF opcional. NF-e e NFS-e ficam para a venda
 * transferida ao fluxo financeiro com o cliente identificado.
 *
 * Aqui só se monta o pedido de emissão (EmitNfceDto) a partir da venda: os
 * itens com o cadastro fiscal dos produtos e os pagamentos com as formas
 * recebidas no caixa. Os valores da venda são em centavos; a NFC-e, em reais.
 */
import type { EmitNfceDto } from '../../fiscal/nfce/dtos/nfce.dto';

export type SaleNfceItem = {
  productId: string | null;
  name: string;
  code: string | null;
  quantity: number;
  /** O valor final do item, em centavos */
  finalValue: number;
  fiscal: {
    productCode: string | null;
    ncm: string | null;
    cest: string | null;
    cean: string | null;
    commercialUnit: string | null;
    cfopInState: string | null;
    icmsCst: string | null;
    pisCst: string | null;
    cofinsCst: string | null;
  } | null;
};

export type SaleNfcePart = {
  method: 'CASH' | 'PIX' | 'CARD';
  /** Centavos */
  amount: number;
  /** O código da forma no cadastro (CRD crédito, DEB débito) */
  methodCode?: string | null;
};

/** O tPag da NFC-e: dinheiro, PIX, crédito, débito. */
export const nfcePaymentType = (part: SaleNfcePart) =>
  part.method === 'CASH'
    ? '01'
    : part.method === 'PIX'
      ? '17'
      : part.methodCode === 'DEB'
        ? '04'
        : '03';

const reais = (cents: number) => Math.round(cents) / 100;

export class SaleNfceError extends Error {}

export function buildSaleNfce(input: {
  quotationId: string;
  /** O total da venda depois do arredondamento no balcão (centavos) */
  saleTotal: number;
  items: SaleNfceItem[];
  parts: SaleNfcePart[];
  cpf?: string | null;
  naturezaOperacao: string;
  informacoesComplementares?: string | null;
}): EmitNfceDto {
  const items = input.items.filter((item) => item.finalValue > 0);
  if (!items.length) throw new SaleNfceError('A venda não tem itens com valor');

  const itemsTotal = items.reduce((sum, item) => sum + item.finalValue, 0);
  // O arredondamento no balcão (desconto da venda) entra como desconto dos
  // itens, do último para o primeiro
  let saleDiscount = Math.max(0, itemsTotal - input.saleTotal);
  if (input.saleTotal > itemsTotal) {
    throw new SaleNfceError(
      'O total da venda passa a soma dos itens (entrega ou acréscimo): emita a nota pela tela de notas fiscais',
    );
  }

  const built = items.map((item) => {
    const quantity = Math.max(1, Math.round(item.quantity) || 1);
    // O unitário arredonda para cima; a sobra dos centavos vira desconto
    const unit = Math.ceil(item.finalValue / quantity);
    return {
      item,
      quantity,
      unit,
      discount: unit * quantity - item.finalValue,
    };
  });
  for (let index = built.length - 1; index >= 0 && saleDiscount > 0; index--) {
    const row = built[index];
    const room = row.unit * row.quantity - row.discount - 1;
    const take = Math.min(room, saleDiscount);
    if (take > 0) {
      row.discount += take;
      saleDiscount -= take;
    }
  }

  const cpf = input.cpf?.replace(/\D/g, '') || '';
  if (cpf && cpf.length !== 11) throw new SaleNfceError('CPF inválido');

  const paid = input.parts.reduce((sum, part) => sum + part.amount, 0);
  if (paid < input.saleTotal) {
    throw new SaleNfceError('Receba a venda inteira antes de emitir a NFC-e');
  }

  return {
    quotationId: input.quotationId,
    cpfConsumidor: cpf || undefined,
    naturezaOperacao: input.naturezaOperacao,
    informacoesComplementares: input.informacoesComplementares || undefined,
    itens: built.map(({ item, quantity, unit, discount }) => ({
      productId: item.productId ?? '',
      codigo: item.fiscal?.productCode || item.code || '',
      descricao: item.name,
      ncm: item.fiscal?.ncm || '',
      cest: item.fiscal?.cest || undefined,
      cfop: item.fiscal?.cfopInState || '5102',
      unidade: item.fiscal?.commercialUnit || 'UN',
      quantidade: quantity,
      valorUnitario: reais(unit),
      valorDesconto: discount > 0 ? reais(discount) : undefined,
      cean: item.fiscal?.cean || undefined,
      icmsCst: item.fiscal?.icmsCst || undefined,
      pisCst: item.fiscal?.pisCst || undefined,
      cofinsCst: item.fiscal?.cofinsCst || undefined,
    })),
    // O troco já saiu da parte em dinheiro no caixa: os pagamentos somam o
    // total e o troco da nota é zero
    pagamentos: input.parts
      .filter((part) => part.amount > 0)
      .map((part) => ({
        tipo: nfcePaymentType(part),
        valor: reais(part.amount),
      })),
    valorTroco: Math.max(0, reais(paid - input.saleTotal)) || undefined,
  } as EmitNfceDto;
}
