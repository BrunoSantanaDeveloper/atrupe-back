/**
 * Includes reutilizáveis para queries de Order
 * Extraídos do método findOne() para melhor manutenibilidade
 */

export const ORDER_NFES_SELECT = {
  where: { status: 'AUTHORIZED' as const },
  orderBy: { createdAt: 'desc' as const },
  take: 1,
  select: {
    id: true,
    numero: true,
    serie: true,
    status: true,
    chaveAcesso: true,
    danfeUrl: true,
    dataEmissao: true,
  },
};

export const ORDER_SERIES_SELECT = {
  id: true,
  title: true,
  code: true,
};

export const ORDER_SELLER_SELECT = {
  include: {
    user: {
      select: {
        id: true,
        name: true,
      },
    },
  },
};

export const ORDER_CONTACT_SELECT = {
  id: true,
  name: true,
};

export const ORDER_COMPANY_SELECT = {
  id: true,
  name: true,
  cnpj: true,
};

export const ORDER_CLIENT_SELECT = {
  id: true,
  type: true,
  name: true,
  status: true,
  cnpj: true,
  cpf: true,
  email: true,
  phone: true,
};

export const ORDER_CLIENT_ADDRESS_SELECT = {
  id: true,
  street: true,
  number: true,
  complement: true,
  neighborhood: true,
  city: true,
  state: true,
  zipcode: true,
  type: true,
};

export const ORDER_DELIVERY_INFO_INCLUDE = {
  supplier: true,
  deliverySchedule: true,
  clientAddress: {
    select: ORDER_CLIENT_ADDRESS_SELECT,
  },
};

export const ORDER_QUOTATION_PRODUCT_ITEMS_SELECT = {
  id: true,
  productItemId: true,
  name: true,
  unitKind: true,
  salePrice: true,
  quantity: true,
  unitCost: true,
  totalValue: true,
  originalQuantity: true,
  weight: true,
  width: true,
  height: true,
  length: true,
  duration: true,
  distance: true,
  volume: true,
};

export const ORDER_QUOTATION_PRODUCT_INCLUDE = {
  product: true,
  items: {
    select: ORDER_QUOTATION_PRODUCT_ITEMS_SELECT,
    orderBy: {
      createdAt: 'asc' as const,
    },
  },
};

export const ORDER_TAG_SELECT = {
  id: true,
  title: true,
  color: true,
};

export const ORDER_PAYMENT_CONDITION_INCLUDE = {
  paymentMethod: {
    select: {
      id: true,
      name: true,
    },
  },
};

export const ORDER_QUOTATION_PAYMENT_SELECT = {
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
  totalValue: true,
  finalValue: true,
  description: true,
  commission: {
    include: {
      supplier: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
  paymentCondition: {
    include: ORDER_PAYMENT_CONDITION_INCLUDE,
  },
  quotationInstallment: {
    include: {
      paymentCondition: true,
      payableInstallment: true,
      receivableInstallment: true,
    },
  },
};

export const ORDER_QUOTATION_INCLUDE = {
  series: {
    select: ORDER_SERIES_SELECT,
  },
  seller: ORDER_SELLER_SELECT,
  contact: {
    select: ORDER_CONTACT_SELECT,
  },
  contactSource: {
    select: ORDER_CONTACT_SELECT,
  },
  company: {
    select: ORDER_COMPANY_SELECT,
  },
  client: {
    select: ORDER_CLIENT_SELECT,
  },
  deliveryInfo: {
    include: ORDER_DELIVERY_INFO_INCLUDE,
  },
  quotationProduct: {
    include: ORDER_QUOTATION_PRODUCT_INCLUDE,
    orderBy: {
      createdAt: 'asc' as const,
    },
  },
  tag: {
    select: ORDER_TAG_SELECT,
  },
  payable: true,
  receivable: true,
  quotationPayment: {
    select: ORDER_QUOTATION_PAYMENT_SELECT,
  },
};

/**
 * Include completo para Order.findOne()
 * Usado para carregar todos os dados necessários para a tela de detalhes do pedido
 */
export const ORDER_FIND_ONE_INCLUDE = {
  quotation: {
    include: ORDER_QUOTATION_INCLUDE,
  },
  nfes: ORDER_NFES_SELECT,
};
