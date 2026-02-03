/**
 * Transformadores para dados de PDF de Quotation
 * Extraídos do método getQuotationPdfData() para melhor testabilidade
 */

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
    signatureUrl: string | null;
  };
  series?: {
    code: string;
    title: string;
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

export function transformPdfContact(client: QuotationPdfRaw['client']) {
  if (!client?.contacts?.[0]) return null;

  const contact = client.contacts[0];
  return {
    name: contact.name,
    phone: contact.phone,
    email: contact.email,
    notes: contact.notes,
  };
}

export function transformPdfQuotationInfo(quotation: QuotationPdfRaw) {
  return {
    number: quotation.quotationNumber,
    seriesCode: quotation.series?.code,
    description: quotation.description,
    seller: {
      name: quotation.seller.name,
      signature: quotation.seller.signatureUrl,
    },
    createdAt: quotation.createdAt,
    dueDate: quotation.dueDate,
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

export function transformPdfQuotationItem(qp: any) {
  const unitValue = qp.items.reduce((total: number, item: any) => {
    return total + (item.unitCost || 0);
  }, 0);

  const totalValue = qp.items.reduce(
    (total: number, item: any) => total + item.totalValue,
    0,
  );

  const getImage = () => {
    if (qp.imageUrl) {
      const isOriginal = qp.imageUrl === qp.product.imageUrl;
      return { url: qp.imageUrl, original: isOriginal };
    }
    return { url: qp.product.imageUrl, original: true };
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
        unitOfMeasure: null,
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

export function transformPdfQuotationItems(quotationProducts: any[]) {
  return quotationProducts.map(transformPdfQuotationItem);
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
    daysAfterApproval: deliveryInfo.daysAfterApproval,
    estimatedDate: deliveryInfo.estimatedDate,
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
  return {
    subtotal: quotation.totalValue,
    totalDiscount: quotation.quotationPayment?.discountTotal || 0,
    finalTotal:
      quotation.totalValue - (quotation.quotationPayment?.discountTotal || 0),
  };
}

/**
 * Transforma uma quotation do Prisma para o formato de dados do PDF
 * Nota: availablePaymentMethods deve ser buscado separadamente (async)
 */
export function transformQuotationToPdfData(
  quotation: QuotationPdfRaw,
  availablePaymentMethods: string[] = [],
) {
  return {
    company: transformPdfCompany(quotation.company),
    client: transformPdfClient(quotation.client),
    contact: transformPdfContact(quotation.client),
    quotation: transformPdfQuotationInfo(quotation),
    order: transformPdfOrder(quotation.order, quotation.approvedAt),
    quotationItems: transformPdfQuotationItems(quotation.quotationProduct),
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
