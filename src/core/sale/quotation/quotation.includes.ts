/**
 * Includes reutilizáveis para queries de Quotation
 * Extraídos do método findOne() para melhor manutenibilidade
 */

export const QUOTATION_SERIES_SELECT = {
  id: true,
  title: true,
  code: true,
  currentBudgetNumber: true,
} as const;

export const QUOTATION_ORDER_SELECT = {
  id: true,
} as const;

export const QUOTATION_CLIENT_SELECT = {
  id: true,
  type: true,
  name: true,
  status: true,
  cnpj: true,
  cpf: true,
  email: true,
  phone: true,
} as const;

export const QUOTATION_SELLER_INCLUDE = {
  user: {
    select: {
      id: true,
      name: true,
    },
  },
  sellerProfile: {
    select: {
      maxDiscount: true,
    },
  },
} as const;

export const QUOTATION_CONTACT_SELECT = {
  id: true,
  name: true,
} as const;

export const QUOTATION_CONTACT_SOURCE_SELECT = {
  id: true,
  name: true,
} as const;

export const QUOTATION_SUB_COMPANY_SELECT = {
  id: true,
  name: true,
  cnpj: true,
} as const;

export const QUOTATION_CLIENT_ADDRESS_SELECT = {
  id: true,
  street: true,
  number: true,
  complement: true,
  neighborhood: true,
  city: true,
  state: true,
  zipcode: true,
  type: true,
} as const;

export const QUOTATION_DELIVERY_INFO_SELECT = {
  id: true,
  deliveryType: true,
  daysAfterApproval: true,
  estimatedDate: true,
  cost: true,
  value: true,
  notes: true,
  supplier: true,
  modality: true,
  clientAddressId: true,
  createdAt: true,
  updatedAt: true,
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

export const QUOTATION_PAYMENT_CONDITION_SELECT = {
  id: true,
  name: true,
} as const;

export const QUOTATION_COMMISSION_SELECT = {
  type: true,
  supplier: {
    select: {
      id: true,
      name: true,
    },
  },
  transferMethod: true,
  commissionValue: true,
  totalCommission: true,
  commissionType: true,
} as const;

export const QUOTATION_PAYMENT_SELECT = {
  id: true,
  type: true,
  billing: true,
  discountValue: true,
  discountType: true,
  discountTotal: true,
  downPayment: true,
  downPaymentConditionId: true,
  downPaymentDueDate: true,
  downPaymentAdditionalFee: true,
  installmentQty: true,
  minInstallmentQty: true,
  maxInstallmentQty: true,
  mainAdditionalFee: true,
  additionalFeeType: true,
  paymentCondition: {
    select: {
      id: true,
      name: true,
      generateInvoice: true,
      invoiceType: true,
    },
  },
  totalValue: true,
  finalValue: true,
  description: true,
  commission: {
    select: {
      type: true,
      supplier: {
        select: {
          id: true,
          name: true,
        },
      },
      transferMethod: true,
      commissionValue: true,
      totalCommission: true,
      commissionType: true,
    },
  },
  quotationInstallment: {
    include: {
      paymentCondition: true,
    },
  },
} as const;

export const QUOTATION_PRODUCT_ITEM_SELECT = {
  id: true,
  productItemId: true,
  name: true,
  unitKind: true,
  salePrice: true,
  quantity: true,
  originalQuantity: true,
  unitCost: true,
  totalValue: true,
  weight: true,
  width: true,
  height: true,
  duration: true,
  length: true,
  distance: true,
  volume: true,
} as const;

/** O que sai da linha acrescentada no item: sem custo e sem retrato (ORC-7). */
export const LINE_VIEW_SELECT = {
  id: true,
  kind: true,
  name: true,
  sector: true,
  tags: true,
  price: true,
  followsBase: true,
  measure: true,
  processId: true,
  productId: true,
} as const;

export const QUOTATION_PRODUCT_SELECT = {
  id: true,
  notes: true,
  imageUrl: true,
  imageSize: true,
  discount: true,
  technicalDescription: true,
  discountType: true,
  finalValue: true,
  allowEditDescription: true,
  allowEditValues: true,
  product: {
    select: {
      id: true,
      name: true,
      imageUrl: true,
      // Produto inativo no orçamento aberto (PAD-7) e a marca da composição
      isActive: true,
      assemblies: {
        where: { variationKey: '' },
        select: { status: true, _count: { select: { blocks: true } } },
      },
    },
  },
  productId: true,
  origin: true,
  addition: true,
  // As escolhas da composição; o retrato (snapshot) tem custo e fica fora
  composition: true,
  // As linhas acrescentadas (ORC-5), sem custo nem retrato (ORC-7)
  linesTotal: true,
  lines: {
    select: LINE_VIEW_SELECT,
    orderBy: { createdAt: 'asc' },
  },
  variation: { select: { id: true, name: true } },
  description: true,
  quantity: true,
  totalValue: true,
  items: {
    select: {
      id: true,
      productItemId: true,
      name: true,
      unitKind: true,
      salePrice: true,
      quantity: true,
      originalQuantity: true,
      unitCost: true,
      totalValue: true,
      weight: true,
      width: true,
      height: true,
      duration: true,
      length: true,
      distance: true,
      volume: true,
      productItem: {
        select: {
          salePrice: true,
        },
      },
    },
    orderBy: {
      createdAt: 'asc' as const,
    },
  },
} as const;

/**
 * Include completo para findOne()
 * Usado para buscar todos os dados necessários de um orçamento
 */
export const QUOTATION_FIND_ONE_INCLUDE = {
  series: {
    select: QUOTATION_SERIES_SELECT,
  },
  order: {
    select: QUOTATION_ORDER_SELECT,
  },
  client: {
    select: QUOTATION_CLIENT_SELECT,
  },
  seller: {
    include: QUOTATION_SELLER_INCLUDE,
  },
  contact: {
    select: QUOTATION_CONTACT_SELECT,
  },
  contactSource: {
    select: QUOTATION_CONTACT_SOURCE_SELECT,
  },
  subCompany: {
    select: QUOTATION_SUB_COMPANY_SELECT,
  },
  deliveryInfo: {
    select: QUOTATION_DELIVERY_INFO_SELECT,
  },
  quotationPayment: {
    select: QUOTATION_PAYMENT_SELECT,
  },
  quotationProduct: {
    select: QUOTATION_PRODUCT_SELECT,
    orderBy: {
      createdAt: 'asc' as const,
    },
  },
};
