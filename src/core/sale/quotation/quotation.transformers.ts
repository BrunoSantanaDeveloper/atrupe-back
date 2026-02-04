/**
 * Transformadores para dados de Quotation
 * Extraídos do método findOne() para melhor testabilidade
 */

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
    sellerProfile?: { maxDiscount: number | null } | null;
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

export function transformQuotationItem(qp: any) {
  const unitValue = qp.items.reduce((total: number, item: any) => {
    return total + (item.unitCost || 0);
  }, 0);

  const totalValue = qp.items.reduce(
    (total: number, item: any) => total + item.totalValue,
    0,
  );

  const getImage = () => {
    // Determina o tamanho da imagem: usa imageSize se disponível, senão fallback para lógica legada
    const isOriginal = qp.imageUrl ? qp.imageUrl === qp.product.imageUrl : true;
    const size = qp.imageSize ?? (isOriginal ? 'small' : 'large');

    if (qp.imageUrl) {
      return { url: qp.imageUrl, original: isOriginal, size };
    }
    return { url: qp.product.imageUrl, original: true, size: 'small' };
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
      originalProductId: qp.productId,
      name: qp.product.name,
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

export function transformQuotationItems(quotationProducts: any[]) {
  return quotationProducts.map(transformQuotationItem);
}

/**
 * Transforma uma quotation do Prisma para o formato de resposta da API
 */
export function transformQuotationToResponse(
  quotation: QuotationWithRelations,
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
    quotationItems: transformQuotationItems(quotation.quotationProduct),
  };
}
