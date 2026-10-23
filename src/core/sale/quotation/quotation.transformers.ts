/**
 * Transformadores para dados de Quotation
 * Extraídos do método findOne() para melhor testabilidade
 */
import { DEFAULT_IMAGE_SIZE, FALLBACK_IMAGE_SIZE } from './quotation.utils';
import {
  itemProductName,
  itemValuesOf,
  materialVariationName,
} from './item-origin';
import { itemSheetCount } from '../../material/sheet-count';
import { BasePriceContext, basePriceOf } from './item-base-price';

type QuotationWithRelations = {
  id: string;
  companyId: string;
  sellerId: string | null;
  createdAt: Date;
  updatedAt: Date;
  dueDate: Date | null;
  finishedAt: Date | null;
  description: string | null;
  status: string;
  totalValue: number;
  quickSale: boolean;
  quotationNumber: number;
  order?: { id: string } | null;
  series?: {
    id: string;
    title: string;
    code: string;
  } | null;
  seller?: {
    id: string;
    name: string | null;
    user: { id: string; name: string };
    sellerProfile?: {
      maxDiscount: number | null;
      onlySendToCash?: boolean;
    } | null;
  } | null;
  contact?: { id: string; name: string } | null;
  contactSource?: { id: string; name: string } | null;
  subCompany?: { id: string; name: string; cnpj: string | null } | null;
  client?: {
    id: string;
    type: string;
    name: string;
    status: string;
    cnpj: string | null;
    cpf: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  deliveryInfo?: any;
  quotationPayment?: any;
  quotationProduct: any[];
};

export function transformSeries(
  series: QuotationWithRelations['series'],
  quotationNumber: number,
) {
  if (!series) return null;
  return {
    id: series.id,
    name: series.title,
    code: series.code,
    quotation: quotationNumber,
  };
}

export function transformSeller(seller: QuotationWithRelations['seller']) {
  if (!seller) return null;
  return {
    id: seller.id,
    name: seller.name ?? seller.user.name,
    maxDiscount: seller.sellerProfile?.maxDiscount ?? null,
    // O vendedor que só envia ao caixa não cobra a venda rápida: sem o campo,
    // a tela mostrava "Cobrar" e ele só descobria na recusa (FC-12.1)
    onlySendToCash: seller.sellerProfile?.onlySendToCash ?? false,
  };
}

export function transformContact(contact: QuotationWithRelations['contact']) {
  if (!contact) return null;
  return {
    id: contact.id,
    name: contact.name,
  };
}

export function transformCompany(
  subCompany: QuotationWithRelations['subCompany'],
) {
  if (!subCompany) return null;
  return {
    id: subCompany.id,
    name: subCompany.name,
    cnpj: subCompany.cnpj,
  };
}

export function transformClient(client: QuotationWithRelations['client']) {
  if (!client) return null;
  return {
    id: client.id,
    type: client.type,
    name: client.name,
    status: client.status,
    cnpj: client.cnpj,
    cpf: client.cpf,
    email: client.email,
    phoneNumber: client.phone,
  };
}

export function transformDeliveryInfo(deliveryInfo: any) {
  if (!deliveryInfo) return null;

  return {
    id: deliveryInfo.id,
    type: deliveryInfo.deliveryType,
    timeFrame: deliveryInfo.daysAfterApproval,
    estimateDate: deliveryInfo.estimatedDate,
    cost: deliveryInfo.cost,
    value: deliveryInfo.value,
    notes: deliveryInfo.notes,
    modality: deliveryInfo.modality,
    clientAddressId: deliveryInfo.clientAddressId,
    deliveryTime: deliveryInfo.deliveryTime,
    deliveryDisplayMode: deliveryInfo.deliveryDisplayMode ?? 'DAYS',
    createdAt: deliveryInfo.createdAt,
    updatedAt: deliveryInfo.updatedAt,
    clientAddress: deliveryInfo.clientAddress
      ? {
          id: deliveryInfo.clientAddress.id,
          street: deliveryInfo.clientAddress.street,
          number: deliveryInfo.clientAddress.number,
          complement: deliveryInfo.clientAddress.complement,
          neighborhood: deliveryInfo.clientAddress.neighborhood,
          city: deliveryInfo.clientAddress.city,
          state: deliveryInfo.clientAddress.state,
          zipcode: deliveryInfo.clientAddress.zipcode,
          type: deliveryInfo.clientAddress.type,
        }
      : null,
    supplier: deliveryInfo.supplier
      ? {
          id: deliveryInfo.supplier.id,
          name: deliveryInfo.supplier.name,
        }
      : null,
  };
}

export function transformPaymentConditions(quotationPayment: any) {
  if (!quotationPayment) return null;

  return {
    id: quotationPayment.id,
    type: quotationPayment.type,
    billing: quotationPayment.billing,
    discount: {
      discountValue: quotationPayment.discountValue || 0,
      discountType: quotationPayment.discountType || 'VALUE',
      discountTotal: quotationPayment.discountTotal || 0,
    },
    installmentQty: quotationPayment.installmentQty,
    minInstallmentQty: quotationPayment.minInstallmentQty,
    maxInstallmentQty: quotationPayment.maxInstallmentQty,
    mainAdditionalFee: quotationPayment.mainAdditionalFee,
    additionalFeeType: quotationPayment.additionalFeeType,
    hasDownPayment: quotationPayment.downPayment > 0,
    downPayment:
      quotationPayment.downPayment > 0
        ? {
            amount: quotationPayment.downPayment,
            dueDate: quotationPayment.downPaymentDueDate,
            additionalFee: quotationPayment.downPaymentAdditionalFee,
            paymentConditionId: quotationPayment.downPaymentConditionId,
          }
        : null,
    paymentCondition: quotationPayment.paymentCondition
      ? {
          id: quotationPayment.paymentCondition.id,
          name: quotationPayment.paymentCondition.name,
        }
      : null,
    totalValue: quotationPayment.totalValue,
    finalValue: quotationPayment.finalValue,
    description: quotationPayment.description,
    commission: quotationPayment.commission
      ? {
          type: quotationPayment.commission.type,
          supplier: {
            id: quotationPayment.commission.supplier.id,
            name: quotationPayment.commission.supplier.name,
          },
          transferMethod: quotationPayment.commission.transferMethod,
          commissionValue: quotationPayment.commission.commissionValue,
          commissionType: quotationPayment.commission.commissionType,
          totalCommission: quotationPayment.commission.totalCommission,
        }
      : null,
    installments:
      quotationPayment.quotationInstallment?.length > 0
        ? quotationPayment.quotationInstallment.map(
            (installment: any, index: number) => ({
              id: installment.id,
              installmentNumber: index + 1,
              dueDate: installment.dueDate,
              paymentConditionId: installment.paymentConditionId,
              additionalFee: installment.additionalFee,
              amount: installment.value,
            }),
          )
        : null,
  };
}

export function transformQuotationItem(qp: any, base?: BasePriceContext) {
  // Valor original do produto no catálogo (imutável, nunca alterado por
  // edições no orçamento). O item sem produto tem o valor nele mesmo
  const { unitValue, totalValue, originalValue } = itemValuesOf(qp);

  const getImage = () => {
    // Determina o tamanho da imagem: usa imageSize se disponível, senão fallback para lógica legada
    const isOriginal = qp.imageUrl
      ? qp.imageUrl === qp.product?.imageUrl
      : true;
    const size =
      qp.imageSize || (isOriginal ? DEFAULT_IMAGE_SIZE : FALLBACK_IMAGE_SIZE);

    if (qp.imageUrl) {
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
    originalValue,
    // O preço do cadastro na medida e na quantidade do item, sem a edição do
    // vendedor (EC-2, ALT-8); nulo sem referência. Só no detalhe
    ...(base ? { basePrice: basePriceOf(qp, base) } : {}),
    finalValue: qp.finalValue,
    // Acréscimo em centavos, fora do desconto (ALT-25)
    addition: qp.addition ?? 0,
    // As linhas acrescentadas dentro do item (ORC-5) e a soma delas
    linesTotal: qp.linesTotal ?? 0,
    lines: qp.lines ?? [],
    origin: qp.origin ?? 'PRODUCT',
    variation: qp.variation
      ? { id: qp.variation.id, name: qp.variation.name }
      : null,
    // A variação com papel: peças por folha e folhas do item, sem custo
    // (Papéis no LITE, 13/10/2026); nula sem papel
    sheetCount: itemSheetCount(qp),
    composition: qp.composition ?? null,
    image: getImage(),
    // O item montado na hora (ORC-11): o rascunho em que foi montado, a
    // medida (mm) e as etapas; sem etapa, "Exige atenção" (MS-12)
    draft: qp.draftId
      ? {
          id: qp.draftId,
          width: qp.draft?.width ?? null,
          height: qp.draft?.height ?? null,
          stages: qp.draft?.assembly?._count?.blocks ?? 0,
        }
      : null,
    attention: qp.origin === 'COMPOSED' && !qp.draft?.assembly?._count?.blocks,
    // O material de venda direta (ORG-1); nulo nos outros itens
    material: qp.materialId
      ? {
          id: qp.materialId,
          name: qp.material?.name ?? null,
          unit: qp.material?.unit ?? null,
          sector: qp.material?.sector?.name ?? null,
          variationId: qp.materialVariation?.id ?? null,
          variation: materialVariationName(qp.materialVariation),
          unitPrice: qp.unitPrice ?? null,
        }
      : null,
    product: {
      // Nulo no material e no item montado na hora
      originalProductId: qp.productId ?? null,
      name: itemProductName(qp),
      isActive: qp.product
        ? (qp.product.isActive ?? true)
        : (qp.material?.active ?? true),
      hasComposition: !!qp.product?.assemblies?.[0]?._count?.blocks,
      quantity: qp.quantity,
      unitValue,
      finalValue: totalValue,
      compositions: qp.items.map((item: any) => ({
        id: item.id,
        originalCompositionId: item.productItemId,
        name: item.name,
        unitKind: item.unitKind,
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
  };
}

export function transformQuotationItems(
  quotationProducts: any[],
  base?: BasePriceContext,
) {
  return quotationProducts.map((item) => transformQuotationItem(item, base));
}

/**
 * Transforma uma quotation do Prisma para o formato de resposta da API
 */
export function transformQuotationToResponse(
  quotation: QuotationWithRelations,
  base?: BasePriceContext,
) {
  const isOverdue =
    quotation.dueDate &&
    quotation.dueDate < new Date() &&
    quotation.status === 'DONE';

  return {
    id: quotation.id,
    companyId: quotation.companyId,
    sellerId: quotation.sellerId,
    orderId: quotation.order?.id ?? null,
    quotationNumber: quotation.quotationNumber,
    createdAt: quotation.createdAt,
    updatedAt: quotation.updatedAt,
    dueDate: quotation.dueDate,
    finishedAt: quotation.finishedAt,
    description: quotation.description,
    status: isOverdue ? 'OVERDUE' : quotation.status,
    totalValue: quotation.totalValue,
    contactSource: quotation.contactSource,
    quickSale: quotation.quickSale || false,
    serie: transformSeries(quotation.series, quotation.quotationNumber),
    seller: transformSeller(quotation.seller),
    contact: transformContact(quotation.contact),
    company: transformCompany(quotation.subCompany),
    client: transformClient(quotation.client),
    deliveryInfo: transformDeliveryInfo(quotation.deliveryInfo),
    paymentConditions: transformPaymentConditions(quotation.quotationPayment),
    quotationItems: transformQuotationItems(quotation.quotationProduct, base),
  };
}
