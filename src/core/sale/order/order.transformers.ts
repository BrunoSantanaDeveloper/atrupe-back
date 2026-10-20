import { itemProductName, itemValuesOf } from '../quotation/item-origin';
import { SheetCountPaper, itemSheetCount } from '../../material/sheet-count';
/**
 * Transformadores para dados de Order
 * Extraídos do método findOne() para melhor testabilidade
 */

type OrderRaw = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  canceledAt: Date | null;
  deliveredAt: Date | null;
  status: string;
  quotation: QuotationRaw;
  nfes: any[];
  nfces: any[];
  nfses: any[];
};

type QuotationRaw = {
  id: string;
  companyId: string;
  sellerId: string;
  quotationNumber: number;
  description: string | null;
  status: string;
  totalValue: number;
  createdAt: Date;
  dueDate: Date | null;
  approvedAt: Date | null;
  finishedAt: Date | null;
  quickSale: boolean;
  series: { id: string; title: string; code: string } | null;
  seller: {
    id: string;
    name: string | null;
    user: { id: string; name: string };
  } | null;
  contact: { id: string; name: string } | null;
  contactSource: { id: string; name: string } | null;
  company: { id: string; name: string; cnpj: string } | null;
  client: ClientRaw | null;
  deliveryInfo: DeliveryInfoRaw | null;
  quotationProduct: QuotationProductRaw[];
  tag: { id: string; title: string; color: string } | null;
  quotationPayment: QuotationPaymentRaw | null;
  receivable: any[];
  payable: any[];
};

type ClientRaw = {
  id: string;
  type: string;
  name: string;
  corporateName: string | null;
  status: string;
  cnpj: string | null;
  cpf: string | null;
  email: string | null;
  phone: string | null;
  address: AddressRaw[] | null;
};

type DeliveryInfoRaw = {
  id: string;
  deliveryType: string;
  daysAfterApproval: number | null;
  estimatedDate: Date | null;
  cost: number | null;
  value: number | null;
  notes: string | null;
  modality: string | null;
  clientAddressId: string | null;
  clientAddress: AddressRaw | null;
  supplier: { id: string; name: string } | null;
  deliverySchedule: { status: string } | null;
};

type AddressRaw = {
  id: string;
  street: string;
  number: string;
  complement: string | null;
  neighborhood: string;
  city: string;
  state: string;
  zipcode: string;
  type: string;
};

type QuotationProductRaw = {
  id: string;
  // Nulo no material de venda direta e no item montado na hora
  productId: string | null;
  totalValue?: number | null;
  unitPrice?: number | null;
  material?: { name: string } | null;
  materialVariation?: { brand: string; color: string } | null;
  // A variação e o papel dela (Papéis no LITE)
  variation?: { name: string; paper: SheetCountPaper | null } | null;
  description: string | null;
  allowEditDescription: boolean;
  allowEditValues: boolean;
  technicalDescription: string | null;
  notes: string | null;
  discountType: string | null;
  discount: number;
  quantity: number;
  finalValue: number;
  imageUrl: string | null;
  product: {
    name: string;
    imageUrl: string | null;
    isService: boolean;
  } | null;
  items: ProductItemRaw[];
};

type ProductItemRaw = {
  id: string;
  productItemId: string;
  name: string;
  unitKind: string | null;
  quantity: number;
  originalQuantity: number;
  unitCost: number | null;
  totalValue: number;
  weight: number | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  length: number | null;
  distance: number | null;
  volume: number | null;
};

type QuotationPaymentRaw = {
  id: string;
  type: string;
  billing: string;
  discountValue: number | null;
  discountType: string | null;
  discountTotal: number | null;
  downPayment: number;
  downPaymentConditionId: string | null;
  downPaymentDueDate: Date | null;
  downPaymentAdditionalFee: number | null;
  installmentQty: number;
  minInstallmentQty: number;
  maxInstallmentQty: number;
  mainAdditionalFee: number | null;
  additionalFeeType: string | null;
  totalValue: number;
  finalValue: number;
  description: string | null;
  commission: CommissionRaw | null;
  paymentCondition: { id: string; name: string } | null;
  quotationInstallment: InstallmentRaw[];
};

type CommissionRaw = {
  type: string;
  supplier: { id: string; name: string };
  transferMethod: string;
  commissionValue: number;
  commissionType: string;
  totalCommission: number;
};

type InstallmentRaw = {
  id: string;
  dueDate: Date;
  paymentConditionId: string;
  additionalFee: number;
  value: number;
};

// ============================================================
// TRANSFORMER FUNCTIONS
// ============================================================

export function transformOrderSeries(
  series: QuotationRaw['series'],
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

export function transformOrderSeller(seller: QuotationRaw['seller']) {
  if (!seller) return null;
  return {
    id: seller.id,
    name: seller.name ?? seller.user.name,
  };
}

export function transformOrderContact(contact: QuotationRaw['contact']) {
  if (!contact) return null;
  return {
    id: contact.id,
    name: contact.name,
  };
}

export function transformOrderCompany(company: QuotationRaw['company']) {
  if (!company) return null;
  return {
    id: company.id,
    name: company.name,
    cnpj: company.cnpj,
  };
}

export function transformOrderClient(client: ClientRaw | null) {
  if (!client) return null;
  return {
    id: client.id,
    type: client.type,
    name: client.name,
    // Razão social e endereço são os dados do tomador na emissão de NFS-e.
    // Este transformer é uma segunda whitelist depois do select do Prisma:
    // incluir os campos só no select não bastava, eles eram descartados aqui.
    corporateName: client.corporateName,
    status: client.status,
    cnpj: client.cnpj,
    cpf: client.cpf,
    email: client.email,
    phoneNumber: client.phone,
    // `phone` além de `phoneNumber`: a tela de emissão lê `phone`, e sem ele o
    // telefone do tomador aparecia vazio.
    phone: client.phone,
    address: client.address ?? [],
  };
}

export function transformOrderTag(tag: QuotationRaw['tag']) {
  if (!tag) return null;
  return {
    id: tag.id,
    text: tag.title,
    color: tag.color,
  };
}

export function transformOrderDeliveryInfo(
  deliveryInfo: DeliveryInfoRaw | null,
) {
  if (!deliveryInfo) return null;
  return {
    id: deliveryInfo.id,
    status: deliveryInfo.deliverySchedule?.status,
    type: deliveryInfo.deliveryType,
    timeFrame: deliveryInfo.daysAfterApproval,
    estimateDate: deliveryInfo.estimatedDate,
    cost: deliveryInfo.cost,
    value: deliveryInfo.value,
    notes: deliveryInfo.notes,
    modality: deliveryInfo.modality,
    clientAddressId: deliveryInfo.clientAddressId,
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

export function transformOrderItem(qp: QuotationProductRaw) {
  // O item sem produto (material, montado na hora) tem o valor nele mesmo
  const { unitValue, totalValue } = itemValuesOf(qp);

  const image = (() => {
    if (qp.imageUrl) {
      const isOriginal = qp.imageUrl === qp.product?.imageUrl;
      return { url: qp.imageUrl, original: isOriginal };
    }
    return { url: qp.product?.imageUrl ?? null, original: true };
  })();

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
    image,
    // A variação com papel: peças por folha e folhas do item, sem custo
    // (Papéis no LITE, 13/10/2026); nula sem papel
    sheetCount: itemSheetCount(qp),
    product: {
      originalProductId: qp.productId ?? null,
      name: itemProductName(qp),
      isService: qp.product?.isService || false,
      quantity: qp.quantity,
      unitValue,
      finalValue: totalValue,
      compositions: qp.items.map((item) => ({
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

export function transformOrderItems(quotationProducts: QuotationProductRaw[]) {
  return quotationProducts.map(transformOrderItem);
}

export function transformOrderPaymentConditions(
  payment: QuotationPaymentRaw | null,
) {
  if (!payment) return null;

  return {
    id: payment.id,
    type: payment.type,
    billing: payment.billing,
    discount: {
      discountValue: payment.discountValue || 0,
      discountType: payment.discountType || 'VALUE',
      discountTotal: payment.discountTotal || 0,
    },
    installmentQty: payment.installmentQty,
    minInstallmentQty: payment.minInstallmentQty,
    maxInstallmentQty: payment.maxInstallmentQty,
    mainAdditionalFee: payment.mainAdditionalFee,
    additionalFeeType: payment.additionalFeeType,
    hasDownPayment: payment.downPayment > 0,
    downPayment:
      payment.downPayment > 0
        ? {
            amount: payment.downPayment,
            dueDate: payment.downPaymentDueDate,
            additionalFee: payment.downPaymentAdditionalFee,
            paymentConditionId: payment.downPaymentConditionId,
          }
        : null,
    paymentCondition: payment.paymentCondition
      ? {
          id: payment.paymentCondition.id,
          name: payment.paymentCondition.name,
        }
      : null,
    totalValue: payment.totalValue,
    finalValue: payment.finalValue,
    description: payment.description,
    commission: payment.commission
      ? {
          type: payment.commission.type,
          supplier: {
            id: payment.commission.supplier.id,
            name: payment.commission.supplier.name,
          },
          transferMethod: payment.commission.transferMethod,
          commissionValue: payment.commission.commissionValue,
          commissionType: payment.commission.commissionType,
          totalCommission: payment.commission.totalCommission,
        }
      : null,
    installments:
      payment.quotationInstallment.length > 0
        ? payment.quotationInstallment.map((installment, index) => ({
            id: installment.id,
            installmentNumber: index + 1,
            dueDate: installment.dueDate,
            paymentConditionId: installment.paymentConditionId,
            additionalFee: installment.additionalFee,
            amount: installment.value,
          }))
        : null,
  };
}

export function transformOrderFinancial(
  receivables: any[],
  financialTableData: any,
) {
  return {
    status: receivables.length > 0 ? 'BILLED' : 'BILLING_PENDING',
    ...financialTableData,
  };
}

export function transformOrderQuotation(
  quotation: QuotationRaw,
  financialTableData: any,
) {
  return {
    id: quotation.id,
    description: quotation.description,
    createdAt: quotation.createdAt,
    approvedAt: quotation.approvedAt,
    finishedAt: quotation.finishedAt,
    status: quotation.status,
    dueDate: quotation.dueDate,
    totalValue: quotation.totalValue,
    contactSource: quotation.contactSource,
    quickSale: quotation.quickSale || false,
    serie: transformOrderSeries(quotation.series, quotation.quotationNumber),
    seller: transformOrderSeller(quotation.seller),
    contact: transformOrderContact(quotation.contact),
    company: transformOrderCompany(quotation.company),
    deliveryInfo: transformOrderDeliveryInfo(quotation.deliveryInfo),
    client: transformOrderClient(quotation.client),
    tag: transformOrderTag(quotation.tag),
    quotationItems: transformOrderItems(quotation.quotationProduct),
    paymentConditions: transformOrderPaymentConditions(
      quotation.quotationPayment,
    ),
    financial: transformOrderFinancial(
      quotation.receivable,
      financialTableData,
    ),
  };
}

/**
 * Função principal de transformação
 * Converte dados brutos do Prisma para formato de resposta da API
 */
export function transformOrderToResponse(
  order: OrderRaw,
  financialTableData: any,
) {
  return {
    id: order.id,
    companyId: order.quotation.companyId,
    sellerId: order.quotation.sellerId,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    canceledAt: order.canceledAt,
    deliveredAt: order.deliveredAt,
    status: order.status,
    quotation: transformOrderQuotation(order.quotation, financialTableData),
    nfes: order.nfes || [],
    nfces: order.nfces || [],
    nfses: order.nfses || [],
  };
}
