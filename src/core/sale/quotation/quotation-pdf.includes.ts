/**
 * Includes reutilizáveis para queries de PDF de Quotation
 * Extraídos do método getQuotationPdfData() para melhor manutenibilidade
 */

export const PDF_COMPANY_SELECT = {
  name: true,
  cnpj: true,
  email: true,
  phone: true,
  mobile: true,
  siteUrl: true,
  logoUrl: true,
  textBeforeItems: true,
  textAfterItems: true,
  instagram: true,
  facebook: true,
  linkedin: true,
  address: {
    where: { type: 'Principal' as const },
    select: {
      street: true,
      number: true,
      complement: true,
      neighborhood: true,
      city: true,
      state: true,
      zipcode: true,
    },
  },
} as const;

export const PDF_CLIENT_SELECT = {
  name: true,
  type: true,
  cpf: true,
  cnpj: true,
  phone: true,
  email: true,
  notes: true,
  financialNotes: true,
  address: {
    where: { type: 'Principal' as const },
    select: {
      street: true,
      number: true,
      complement: true,
      neighborhood: true,
      city: true,
      state: true,
      zipcode: true,
    },
  },
  contacts: {
    select: {
      name: true,
      phone: true,
      email: true,
      notes: true,
    },
  },
} as const;

export const PDF_SELLER_SELECT = {
  name: true,
} as const;

export const PDF_CONTACT_SELECT = {
  name: true,
  phone: true,
  email: true,
  notes: true,
} as const;

export const PDF_SERIES_SELECT = {
  code: true,
  title: true,
  proposalValidity: true,
} as const;

export const PDF_PRODUCT_ITEM_INCLUDE = {
  productItem: {
    select: {
      name: true,
    },
  },
} as const;

export const PDF_QUOTATION_PRODUCT_INCLUDE = {
  product: {
    select: {
      name: true,
      imageUrl: true,
      technicalDescription: true,
    },
  },
  // O material de venda direta (ORG-1): o nome dele no lugar do produto
  material: { select: { name: true, unit: true } },
  materialVariation: { select: { brand: true, color: true } },
  items: {
    include: PDF_PRODUCT_ITEM_INCLUDE,
    orderBy: {
      createdAt: 'asc' as const,
    },
  },
  variation: { select: { name: true } },
  // As linhas acrescentadas no item (ORC-5), sem custo
  lines: {
    select: { name: true, sector: true, tags: true, price: true },
    orderBy: { createdAt: 'asc' as const },
  },
  // Só para repartir o valor entre as etapas: o retrato não sai (ORC-7)
  snapshot: { select: { data: true } },
} as const;

export const PDF_DELIVERY_INFO_INCLUDE = {
  supplier: {
    select: {
      name: true,
      cnpj: true,
      notes: true,
      financialNotes: true,
    },
  },
  clientAddress: {
    select: {
      id: true,
      street: true,
      number: true,
      complement: true,
      neighborhood: true,
      city: true,
      state: true,
      zipcode: true,
      type: true,
    },
  },
} as const;

export const PDF_PAYMENT_METHOD_SELECT = {
  name: true,
} as const;

export const PDF_PAYMENT_CONDITION_SELECT = {
  id: true,
  name: true,
  paymentMethod: {
    select: PDF_PAYMENT_METHOD_SELECT,
  },
} as const;

export const PDF_QUOTATION_PAYMENT_SELECT = {
  id: true,
  type: true,
  billing: true,
  totalValue: true,
  finalValue: true,
  discountType: true,
  discountValue: true,
  discountTotal: true,
  description: true,
  downPayment: true,
  downPaymentConditionId: true,
  downPaymentDueDate: true,
  downPaymentAdditionalFee: true,
  paymentCondition: {
    select: {
      name: true,
      paymentMethod: {
        select: PDF_PAYMENT_METHOD_SELECT,
      },
    },
  },
  commission: {
    select: {
      type: true,
      commissionValue: true,
      totalCommission: true,
      commissionType: true,
    },
  },
  downPaymentCondition: {
    select: PDF_PAYMENT_CONDITION_SELECT,
  },
  quotationInstallment: {
    include: {
      paymentCondition: {
        include: {
          paymentMethod: {
            select: PDF_PAYMENT_METHOD_SELECT,
          },
        },
      },
    },
    orderBy: {
      dueDate: 'asc' as const,
    },
  },
} as const;

/**
 * Include completo para getQuotationPdfData()
 * Usado para buscar todos os dados necessários para gerar o PDF
 */
export const QUOTATION_PDF_DATA_INCLUDE = {
  company: {
    select: PDF_COMPANY_SELECT,
  },
  order: true,
  client: {
    select: PDF_CLIENT_SELECT,
  },
  seller: {
    select: PDF_SELLER_SELECT,
  },
  contact: {
    select: PDF_CONTACT_SELECT,
  },
  series: {
    select: PDF_SERIES_SELECT,
  },
  quotationProduct: {
    include: PDF_QUOTATION_PRODUCT_INCLUDE,
    orderBy: {
      createdAt: 'asc' as const,
    },
  },
  deliveryInfo: {
    include: PDF_DELIVERY_INFO_INCLUDE,
  },
  quotationPayment: {
    select: PDF_QUOTATION_PAYMENT_SELECT,
  },
};
