/**
 * Transformadores para dados de PDF de Quotation
 * Extraídos do método getQuotationPdfData() para melhor testabilidade
 */
import { DEFAULT_IMAGE_SIZE, FALLBACK_IMAGE_SIZE } from './quotation.utils';

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

export function transformPdfQuotationItem(qp: any) {
  const unitValue = qp.items.reduce((total: number, item: any) => {
    return total + (item.unitCost || 0);
  }, 0);

  const totalValue = qp.items.reduce(
    (total: number, item: any) => total + item.totalValue,
    0,
  );

  const getImage = () => {
    const hasCustomImage = qp.imageUrl !== null && qp.imageUrl !== undefined;
    const isOriginal = hasCustomImage
      ? qp.imageUrl === qp.product.imageUrl
      : true;
    // Usar imageSize do banco ou fallback para lógica legada
    const size =
      qp.imageSize ?? (isOriginal ? DEFAULT_IMAGE_SIZE : FALLBACK_IMAGE_SIZE);

    if (hasCustomImage) {
      return { url: qp.imageUrl, original: isOriginal, size };
    }
    return {
      url: qp.product.imageUrl,
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
) {
  return {
    company: transformPdfCompany(quotation.company),
    client: transformPdfClient(quotation.client),
    contact: transformPdfContact(quotation.contact),
    quotation: transformPdfQuotationInfo(quotation, loggedEmployeeSignatureUrl),
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
