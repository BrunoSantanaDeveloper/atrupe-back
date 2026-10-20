/**
 * Transformadores para dados de PDF de Quotation
 * Extraídos do método getQuotationPdfData() para melhor testabilidade
 */
import { DEFAULT_IMAGE_SIZE, FALLBACK_IMAGE_SIZE } from './quotation.utils';
import { itemProductName, itemValuesOf } from './item-origin';
import { UNIT_SYMBOL } from '../../material/material-text';
import { itemSheetCount } from '../../material/sheet-count';

/**
 * O nível de detalhe da proposta (IP-12): o resumo (só o descritivo), a
 * lista (as etapas e o que cada uma usa) ou os valores (a lista com o valor
 * do item repartido entre as etapas).
 */
export type PdfDetailLevel = 'resumo' | 'lista' | 'valores';

export type PdfOptions = {
  detailLevel: PdfDetailLevel;
  // Sem `values:values:view`, os preços de linha e de etapa não saem
  values: boolean;
};

const DEFAULT_OPTIONS: PdfOptions = { detailLevel: 'valores', values: true };

/**
 * O nível que vale: sem o recurso de plano do detalhamento, o resumo; sem
 * a permissão de valores, os valores caem para a lista. Sem pedido, os
 * valores para quem os vê e a lista para quem não vê.
 */
export function pdfDetailLevel(
  requested: string | undefined,
  { values, itemDetails }: { values: boolean; itemDetails: boolean },
): PdfDetailLevel {
  if (!itemDetails) return 'resumo';
  const level =
    requested === 'resumo' || requested === 'lista' || requested === 'valores'
      ? requested
      : values
        ? 'valores'
        : 'lista';
  return level === 'valores' && !values ? 'lista' : level;
}

type RawStage = {
  name?: string;
  sector?: string;
  sale?: number;
  cost?: number;
  lines?: {
    name?: string;
    resource?: string | null;
    quantity?: number | null;
    unit?: string;
    entries?: { name: string; quantity: number; unit: string }[] | null;
  }[];
};

/**
 * As etapas da composição do item na proposta, pelo nome de venda (o
 * retrato guarda o nome local da etapa). Nos valores, o valor do produto
 * (o do item sem as linhas acrescentadas) é repartido pelo peso de cada
 * etapa no preço sugerido, e as etapas somam esse valor. A etapa vazia não
 * aparece; custo nenhum sai daqui.
 */
export function pdfStagesOf(qp: any, options: PdfOptions) {
  if (options.detailLevel === 'resumo') return [];
  const raw = (qp.snapshot?.data?.stages ?? []) as RawStage[];
  const stages = raw.filter(
    (stage) => (stage.lines?.length ?? 0) > 0 || (stage.cost ?? 0) > 0,
  );
  const listOf = (stage: RawStage) =>
    (stage.lines ?? []).flatMap((line) =>
      line.entries?.length
        ? line.entries.map((entry) => ({
            name: entry.name,
            quantity: entry.quantity,
            unit: entry.unit,
          }))
        : [
            {
              name: line.resource || line.name || '',
              quantity: line.quantity ?? null,
              unit: line.unit ?? '',
            },
          ],
    );

  const withPrices = options.detailLevel === 'valores' && options.values;
  const value = Math.max(0, (qp.finalValue ?? 0) - (qp.linesTotal ?? 0));
  const weights = stages.map((stage) => Math.max(0, stage.sale ?? 0));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  let given = 0;
  return stages.map((stage, index) => {
    const base = {
      name: stage.name ?? '',
      sector: stage.sector ?? '',
      items: listOf(stage),
    };
    if (!withPrices || weightTotal <= 0) return base;
    // A última leva o resto do arredondamento: as etapas somam o valor
    const price =
      index === stages.length - 1
        ? value - given
        : Math.round((value * weights[index]) / weightTotal);
    given += price;
    return { ...base, price };
  });
}

type QuotationPdfRaw = {
  id: string;
  companyId: string;
  clientId: string | null;
  quotationNumber: number;
  description: string | null;
  status: string;
  totalValue: number;
  createdAt: Date;
  dueDate: Date | null;
  approvedAt: Date | null;
  finishedAt: Date | null;
  company: {
    name: string;
    cnpj: string | null;
    email: string | null;
    phone: string | null;
    mobile: string | null;
    siteUrl: string | null;
    logoUrl: string | null;
    textBeforeItems: string | null;
    textAfterItems: string | null;
    instagram: string | null;
    facebook: string | null;
    linkedin: string | null;
    address: Array<{
      street: string | null;
      number: string | null;
      complement: string | null;
      neighborhood: string | null;
      city: string | null;
      state: string | null;
      zipcode: string | null;
    }>;
  };
  client?: {
    name: string;
    type: string;
    cpf: string | null;
    cnpj: string | null;
    phone: string | null;
    email: string | null;
    notes: string | null;
    financialNotes: string | null;
    address: Array<{
      street: string | null;
      number: string | null;
      complement: string | null;
      neighborhood: string | null;
      city: string | null;
      state: string | null;
      zipcode: string | null;
    }>;
    contacts: Array<{
      name: string | null;
      phone: string | null;
      email: string | null;
      notes: string | null;
    }>;
  } | null;
  seller: {
    name: string | null;
  };
  contact?: {
    name: string | null;
    phone: string | null;
    email: string | null;
    notes: string | null;
  } | null;
  series?: {
    code: string;
    title: string;
    proposalValidity: number | null;
  } | null;
  order?: {
    id: string;
    createdAt: Date;
    status: string;
  } | null;
  quotationProduct: any[];
  deliveryInfo?: any;
  quotationPayment?: any;
};

export function transformPdfCompany(company: QuotationPdfRaw['company']) {
  return {
    name: company.name,
    cnpj: company.cnpj,
    email: company.email,
    phone: company.phone,
    mobile: company.mobile,
    siteUrl: company.siteUrl,
    address: company.address[0]
      ? {
          street: company.address[0].street,
          number: company.address[0].number,
          complement: company.address[0].complement,
          neighborhood: company.address[0].neighborhood,
          city: company.address[0].city,
          state: company.address[0].state,
          zipCode: company.address[0].zipcode,
        }
      : null,
    logo: company.logoUrl,
    textBeforeItems: company.textBeforeItems,
    textAfterItems: company.textAfterItems,
    socialNetworks: {
      instagram: company.instagram,
      facebook: company.facebook,
      linkedin: company.linkedin,
    },
  };
}

export function transformPdfClient(client: QuotationPdfRaw['client']) {
  if (!client) return null;

  return {
    name: client.name,
    document: {
      type: client.type === 'PERSON' ? 'CPF' : 'CNPJ',
      value: client.type === 'PERSON' ? client.cpf : client.cnpj,
    },
    phone: client.phone,
    email: client.email,
    notes: client.notes,
    financialNotes: client.financialNotes,
    address: client.address[0]
      ? {
          type: 'PRINCIPAL',
          street: client.address[0].street,
          number: client.address[0].number,
          complement: client.address[0].complement,
          neighborhood: client.address[0].neighborhood,
          city: client.address[0].city,
          state: client.address[0].state,
          zipCode: client.address[0].zipcode,
        }
      : null,
  };
}

export function transformPdfContact(contact: QuotationPdfRaw['contact']) {
  if (!contact) return null;

  return {
    name: contact.name,
    phone: contact.phone,
    email: contact.email,
    notes: contact.notes,
  };
}

export function transformPdfQuotationInfo(
  quotation: QuotationPdfRaw,
  loggedEmployeeSignatureUrl: string | null = null,
) {
  return {
    number: quotation.quotationNumber,
    seriesCode: quotation.series?.code,
    description: quotation.description,
    seller: {
      name: quotation.seller.name,
      // Assinatura é a do colaborador logado que gerou o PDF, não a do vendedor atribuído
      signature: loggedEmployeeSignatureUrl,
    },
    createdAt: quotation.createdAt,
    dueDate: quotation.dueDate,
    proposalValidity: quotation.series?.proposalValidity ?? null,
    approvedAt: quotation.approvedAt,
    finishedAt: quotation.finishedAt,
    status: quotation.status,
  };
}

export function transformPdfOrder(
  order: QuotationPdfRaw['order'],
  approvedAt: Date | null,
) {
  if (!order) return null;

  return {
    id: order.id,
    createdAt: order.createdAt,
    status: order.status,
    approvedAt: approvedAt,
  };
}

export function transformPdfQuotationItem(
  qp: any,
  options: PdfOptions = DEFAULT_OPTIONS,
) {
  // O item sem produto (material, montado na hora) tem o valor nele mesmo
  const { unitValue, totalValue } = itemValuesOf(qp);

  const getImage = () => {
    const hasCustomImage = qp.imageUrl !== null && qp.imageUrl !== undefined;
    const isOriginal = hasCustomImage
      ? qp.imageUrl === qp.product?.imageUrl
      : true;
    // Usar imageSize do banco ou fallback para lógica legada
    const size =
      qp.imageSize ?? (isOriginal ? DEFAULT_IMAGE_SIZE : FALLBACK_IMAGE_SIZE);

    if (hasCustomImage) {
      return { url: qp.imageUrl, original: isOriginal, size };
    }
    return {
      url: qp.product?.imageUrl ?? null,
      original: true,
      size: DEFAULT_IMAGE_SIZE,
    };
  };

  return {
    id: qp.id,
    description: qp.description,
    allowEditDescription: qp.allowEditDescription,
    allowEditValues: qp.allowEditValues,
    technicalDescription: qp.technicalDescription,
    notes: qp.notes,
    discountType: qp.discountType,
    discount: qp.discount,
    unitValue,
    totalValue,
    finalValue: qp.finalValue,
    image: getImage(),
    product: {
      originalProductId: qp.productId ?? null,
      name: itemProductName(qp),
      // A unidade do material de venda direta (m², m, kg…); nula nos outros
      unit: qp.material ? (UNIT_SYMBOL[qp.material.unit] ?? null) : null,
      quantity: qp.quantity,
      unitValue,
      finalValue: totalValue,
      compositions: qp.items.map((item: any) => ({
        id: item.id,
        originalCompositionId: item.productItemId,
        name: item.name,
        unitOfMeasure: null,
        // Sem isto o PDF deduz a unidade pelas dimensões e trata como área o
        // item cobrado por unidade: a proposta saía em m² e por m², enquanto a
        // tela mostrava "un" e o valor por unidade.
        unitKind: item.unitKind ?? null,
        quantity: item.quantity,
        originalQuantity: item.originalQuantity,
        unitValue: item.unitCost || 0,
        totalValue: item.totalValue,
        weight: item.weight,
        width: item.width,
        height: item.height,
        duration: item.duration,
        length: item.length,
        distance: item.distance,
        volume: item.volume,
      })),
    },
    origin: qp.origin ?? 'PRODUCT',
    variation: qp.variation ? { name: qp.variation.name } : null,
    // A ficha da O.S. e a proposta: peças por folha e folhas do item, sem
    // custo (Papéis no LITE, 13/10/2026); nula sem papel na variação
    sheetCount: itemSheetCount(qp),
    // O valor do item já inclui as linhas e o acréscimo embutido (ALT-25):
    // a proposta não tem linha própria de acréscimo
    addition: qp.addition ?? 0,
    linesTotal: qp.linesTotal ?? 0,
    lines: (qp.lines ?? []).map((line: any) => ({
      name: line.name,
      sector: line.sector,
      tags: line.tags ?? [],
      ...(options.values ? { price: line.price } : {}),
    })),
    stages: pdfStagesOf(qp, options),
  };
}

export function transformPdfQuotationItems(
  quotationProducts: any[],
  options: PdfOptions = DEFAULT_OPTIONS,
) {
  return quotationProducts.map((qp) => transformPdfQuotationItem(qp, options));
}

export function transformPdfDelivery(deliveryInfo: any) {
  if (!deliveryInfo) return null;

  return {
    supplier: deliveryInfo.supplier
      ? {
          name: deliveryInfo.supplier.name,
          cnpj: deliveryInfo.supplier.cnpj,
          notes: deliveryInfo.supplier.notes,
          financialNotes: deliveryInfo.supplier.financialNotes,
        }
      : null,
    modality: deliveryInfo.modality ?? null,
    daysAfterApproval: deliveryInfo.daysAfterApproval,
    estimatedDate: deliveryInfo.estimatedDate,
    deliveryTime: deliveryInfo.deliveryTime ?? null,
    deliveryDisplayMode: deliveryInfo.deliveryDisplayMode ?? 'DAYS',
    freightCost: deliveryInfo.cost,
    freightPrice: deliveryInfo.value,
    notes: deliveryInfo.notes,
    clientAddress:
      deliveryInfo.clientAddressId && deliveryInfo.clientAddress
        ? {
            type: deliveryInfo.clientAddress.type,
            street: deliveryInfo.clientAddress.street,
            number: deliveryInfo.clientAddress.number,
            complement: deliveryInfo.clientAddress.complement,
            neighborhood: deliveryInfo.clientAddress.neighborhood,
            city: deliveryInfo.clientAddress.city,
            state: deliveryInfo.clientAddress.state,
            zipCode: deliveryInfo.clientAddress.zipcode,
          }
        : null,
  };
}

export function transformPdfPayment(quotationPayment: any) {
  if (!quotationPayment) return null;

  return {
    condition: quotationPayment.paymentCondition?.name,
    method: quotationPayment.paymentCondition?.name,
    description: quotationPayment.description,
    totalInstallments: quotationPayment.quotationInstallment?.length || 0,
    installments:
      quotationPayment.quotationInstallment?.map((installment: any) => ({
        number: installment.id,
        dueDate: installment.dueDate,
        value: installment.value,
        paymentMethod: installment.paymentCondition?.name,
      })) || [],
    hasDownPayment: quotationPayment.downPayment > 0,
    downPayment:
      quotationPayment.downPayment > 0
        ? {
            amount: quotationPayment.downPayment,
            dueDate: quotationPayment.downPaymentDueDate,
            additionalFee: quotationPayment.downPaymentAdditionalFee,
            paymentConditionId: quotationPayment.downPaymentConditionId,
            paymentCondition: quotationPayment.downPaymentCondition
              ? {
                  id: quotationPayment.downPaymentCondition.id,
                  name: quotationPayment.downPaymentCondition.name,
                  paymentMethod:
                    quotationPayment.downPaymentCondition.paymentMethod?.name,
                }
              : null,
          }
        : null,
  };
}

export function transformPdfTotal(quotation: QuotationPdfRaw) {
  const payment = quotation.quotationPayment as any;
  const commission = payment?.commission;

  // Valores da comissão
  const commissionTotal = commission?.totalCommission || 0;
  const commissionType = commission?.type || null; // 'ADD' | 'SUB' | null

  // Desconto geral aplicado pelo usuário nas condições de pagamento
  const discountTotal = payment?.discountTotal || 0;

  // Subtotal = soma dos quotationProduct.finalValue (já com desconto por item)
  // Este é o valor base sem desconto geral, sem frete e sem comissão
  const subtotal = quotation.totalValue;

  // Frete: o PDF exibe o frete separado e o soma no display final (finalTotalWithFreight),
  // portanto o finalTotal retornado aqui NÃO deve incluir o frete.
  const freightPrice = (quotation.deliveryInfo as any)?.value || 0;

  // Se o backend salvou um finalValue no quotationPayment, ele representa o total
  // calculado pelo frontend (inclui: subtotal + frete + comissão + acréscimos - desconto).
  // Como o PDF soma o frete separado, precisamos subtrair o frete do savedFinalValue.
  const savedFinalValue = payment?.finalValue;

  let finalTotal: number;

  if (savedFinalValue != null && savedFinalValue > 0) {
    // Remover o frete do valor salvo pois o PDF o soma separado
    finalTotal = savedFinalValue - freightPrice;
  } else {
    // Fallback: recalcular manualmente (para orçamentos antigos sem finalValue salvo)
    finalTotal = subtotal - discountTotal;
    if (commissionType === 'ADD' && commissionTotal > 0) {
      finalTotal += commissionTotal;
    }
  }

  return {
    subtotal,
    totalDiscount: discountTotal,
    commissionTotal: commissionType === 'ADD' ? commissionTotal : 0,
    finalTotal,
  };
}

/**
 * Transforma uma quotation do Prisma para o formato de dados do PDF
 * Nota: availablePaymentMethods deve ser buscado separadamente (async)
 */
export function transformQuotationToPdfData(
  quotation: QuotationPdfRaw,
  availablePaymentMethods: string[] = [],
  loggedEmployeeSignatureUrl: string | null = null,
  options: PdfOptions = DEFAULT_OPTIONS,
) {
  return {
    detailLevel: options.detailLevel,
    company: transformPdfCompany(quotation.company),
    client: transformPdfClient(quotation.client),
    contact: transformPdfContact(quotation.contact),
    quotation: transformPdfQuotationInfo(quotation, loggedEmployeeSignatureUrl),
    order: transformPdfOrder(quotation.order, quotation.approvedAt),
    quotationItems: transformPdfQuotationItems(
      quotation.quotationProduct,
      options,
    ),
    delivery: transformPdfDelivery(quotation.deliveryInfo),
    payment: quotation.quotationPayment
      ? {
          ...transformPdfPayment(quotation.quotationPayment),
          availablePaymentMethods,
        }
      : null,
    total: transformPdfTotal(quotation),
  };
}
