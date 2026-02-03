import {
  transformOrderSeries,
  transformOrderSeller,
  transformOrderContact,
  transformOrderCompany,
  transformOrderClient,
  transformOrderTag,
  transformOrderDeliveryInfo,
  transformOrderItem,
  transformOrderItems,
  transformOrderPaymentConditions,
  transformOrderFinancial,
  transformOrderQuotation,
  transformOrderToResponse,
} from './order.transformers';

describe('OrderTransformers', () => {
  // ===========================================
  // transformOrderSeries
  // ===========================================
  describe('transformOrderSeries', () => {
    it('should return null when series is null', () => {
      expect(transformOrderSeries(null, 123)).toBeNull();
    });

    it('should transform series correctly', () => {
      const series = { id: 'series-1', title: 'Série A', code: 'SA' };
      const result = transformOrderSeries(series, 456);

      expect(result).toEqual({
        id: 'series-1',
        name: 'Série A',
        code: 'SA',
        quotation: 456,
      });
    });
  });

  // ===========================================
  // transformOrderSeller
  // ===========================================
  describe('transformOrderSeller', () => {
    it('should return null when seller is null', () => {
      expect(transformOrderSeller(null)).toBeNull();
    });

    it('should use seller name when available', () => {
      const seller = {
        id: 'seller-1',
        name: 'João Vendedor',
        user: { id: 'user-1', name: 'João User' },
      };
      const result = transformOrderSeller(seller);

      expect(result).toEqual({
        id: 'seller-1',
        name: 'João Vendedor',
      });
    });

    it('should fallback to user name when seller name is null', () => {
      const seller = {
        id: 'seller-1',
        name: null,
        user: { id: 'user-1', name: 'João User' },
      };
      const result = transformOrderSeller(seller);

      expect(result).toEqual({
        id: 'seller-1',
        name: 'João User',
      });
    });
  });

  // ===========================================
  // transformOrderContact
  // ===========================================
  describe('transformOrderContact', () => {
    it('should return null when contact is null', () => {
      expect(transformOrderContact(null)).toBeNull();
    });

    it('should transform contact correctly', () => {
      const contact = { id: 'contact-1', name: 'Maria Contato' };
      expect(transformOrderContact(contact)).toEqual({
        id: 'contact-1',
        name: 'Maria Contato',
      });
    });
  });

  // ===========================================
  // transformOrderCompany
  // ===========================================
  describe('transformOrderCompany', () => {
    it('should return null when company is null', () => {
      expect(transformOrderCompany(null)).toBeNull();
    });

    it('should transform company correctly', () => {
      const company = {
        id: 'company-1',
        name: 'Empresa XYZ',
        cnpj: '12.345.678/0001-99',
      };
      expect(transformOrderCompany(company)).toEqual({
        id: 'company-1',
        name: 'Empresa XYZ',
        cnpj: '12.345.678/0001-99',
      });
    });
  });

  // ===========================================
  // transformOrderClient
  // ===========================================
  describe('transformOrderClient', () => {
    it('should return null when client is null', () => {
      expect(transformOrderClient(null)).toBeNull();
    });

    it('should transform client correctly with phone renamed to phoneNumber', () => {
      const client = {
        id: 'client-1',
        type: 'PJ',
        name: 'Cliente ABC',
        status: 'ACTIVE',
        cnpj: '12.345.678/0001-99',
        cpf: null,
        email: 'cliente@abc.com',
        phone: '11999999999',
      };
      const result = transformOrderClient(client);

      expect(result).toEqual({
        id: 'client-1',
        type: 'PJ',
        name: 'Cliente ABC',
        status: 'ACTIVE',
        cnpj: '12.345.678/0001-99',
        cpf: null,
        email: 'cliente@abc.com',
        phoneNumber: '11999999999',
      });
    });
  });

  // ===========================================
  // transformOrderTag
  // ===========================================
  describe('transformOrderTag', () => {
    it('should return null when tag is null', () => {
      expect(transformOrderTag(null)).toBeNull();
    });

    it('should transform tag with title renamed to text', () => {
      const tag = { id: 'tag-1', title: 'Urgente', color: '#ff0000' };
      expect(transformOrderTag(tag)).toEqual({
        id: 'tag-1',
        text: 'Urgente',
        color: '#ff0000',
      });
    });
  });

  // ===========================================
  // transformOrderDeliveryInfo
  // ===========================================
  describe('transformOrderDeliveryInfo', () => {
    it('should return null when deliveryInfo is null', () => {
      expect(transformOrderDeliveryInfo(null)).toBeNull();
    });

    it('should transform delivery info with all fields', () => {
      const deliveryInfo = {
        id: 'delivery-1',
        deliveryType: 'DELIVERY',
        daysAfterApproval: 5,
        estimatedDate: new Date('2024-01-15'),
        cost: 100,
        value: 120,
        notes: 'Entregar pela manhã',
        modality: 'EXPRESS',
        clientAddressId: 'addr-1',
        clientAddress: {
          id: 'addr-1',
          street: 'Rua das Flores',
          number: '123',
          complement: 'Apto 45',
          neighborhood: 'Centro',
          city: 'São Paulo',
          state: 'SP',
          zipcode: '01234-567',
          type: 'COMMERCIAL',
        },
        supplier: { id: 'supplier-1', name: 'Transportadora XYZ' },
        deliverySchedule: { status: 'SCHEDULED' },
      };

      const result = transformOrderDeliveryInfo(deliveryInfo);

      expect(result).toMatchObject({
        id: 'delivery-1',
        status: 'SCHEDULED',
        type: 'DELIVERY',
        timeFrame: 5,
        modality: 'EXPRESS',
        clientAddress: {
          street: 'Rua das Flores',
          city: 'São Paulo',
        },
        supplier: {
          id: 'supplier-1',
          name: 'Transportadora XYZ',
        },
      });
    });

    it('should handle missing nested objects', () => {
      const deliveryInfo = {
        id: 'delivery-2',
        deliveryType: 'PICKUP',
        daysAfterApproval: null,
        estimatedDate: null,
        cost: null,
        value: null,
        notes: null,
        modality: null,
        clientAddressId: null,
        clientAddress: null,
        supplier: null,
        deliverySchedule: null,
      };

      const result = transformOrderDeliveryInfo(deliveryInfo);

      expect(result?.status).toBeUndefined();
      expect(result?.clientAddress).toBeNull();
      expect(result?.supplier).toBeNull();
    });
  });

  // ===========================================
  // transformOrderItem
  // ===========================================
  describe('transformOrderItem', () => {
    const mockQuotationProduct = {
      id: 'qp-1',
      productId: 'prod-1',
      description: 'Produto customizado',
      allowEditDescription: true,
      allowEditValues: false,
      technicalDescription: 'Specs técnicos',
      notes: 'Observações',
      discountType: 'PERCENTAGE',
      discount: 10,
      quantity: 2,
      finalValue: 900,
      imageUrl: null,
      product: {
        name: 'Produto ABC',
        imageUrl: 'https://example.com/image.jpg',
        isService: false,
      },
      items: [
        {
          id: 'item-1',
          productItemId: 'pi-1',
          name: 'Item 1',
          unitKind: 'UN',
          quantity: 5,
          originalQuantity: 5,
          unitCost: 100,
          totalValue: 500,
          weight: 1.5,
          width: 10,
          height: 20,
          duration: null,
          length: 30,
          distance: null,
          volume: 6000,
        },
      ],
    };

    it('should transform quotation product correctly', () => {
      const result = transformOrderItem(mockQuotationProduct);

      expect(result.id).toBe('qp-1');
      expect(result.description).toBe('Produto customizado');
      expect(result.unitValue).toBe(100);
      expect(result.totalValue).toBe(500);
      expect(result.finalValue).toBe(900);
    });

    it('should use product image when imageUrl is null', () => {
      const result = transformOrderItem(mockQuotationProduct);

      expect(result.image).toEqual({
        url: 'https://example.com/image.jpg',
        original: true,
      });
    });

    it('should use custom image when available', () => {
      const productWithCustomImage = {
        ...mockQuotationProduct,
        imageUrl: 'https://example.com/custom.jpg',
      };
      const result = transformOrderItem(productWithCustomImage);

      expect(result.image).toEqual({
        url: 'https://example.com/custom.jpg',
        original: false,
      });
    });

    it('should transform compositions correctly', () => {
      const result = transformOrderItem(mockQuotationProduct);

      expect(result.product.compositions).toHaveLength(1);
      expect(result.product.compositions[0]).toMatchObject({
        id: 'item-1',
        originalCompositionId: 'pi-1',
        name: 'Item 1',
        quantity: 5,
        unitValue: 100,
      });
    });
  });

  // ===========================================
  // transformOrderItems
  // ===========================================
  describe('transformOrderItems', () => {
    it('should transform array of items', () => {
      const products = [
        {
          id: 'qp-1',
          productId: 'prod-1',
          description: null,
          allowEditDescription: false,
          allowEditValues: false,
          technicalDescription: null,
          notes: null,
          discountType: null,
          discount: 0,
          quantity: 1,
          finalValue: 100,
          imageUrl: null,
          product: { name: 'Prod 1', imageUrl: null, isService: false },
          items: [],
        },
        {
          id: 'qp-2',
          productId: 'prod-2',
          description: null,
          allowEditDescription: false,
          allowEditValues: false,
          technicalDescription: null,
          notes: null,
          discountType: null,
          discount: 0,
          quantity: 1,
          finalValue: 200,
          imageUrl: null,
          product: { name: 'Prod 2', imageUrl: null, isService: true },
          items: [],
        },
      ];

      const result = transformOrderItems(products);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('qp-1');
      expect(result[1].id).toBe('qp-2');
    });
  });

  // ===========================================
  // transformOrderPaymentConditions
  // ===========================================
  describe('transformOrderPaymentConditions', () => {
    it('should return null when payment is null', () => {
      expect(transformOrderPaymentConditions(null)).toBeNull();
    });

    it('should transform payment conditions correctly', () => {
      const payment = {
        id: 'payment-1',
        type: 'INSTALLMENT',
        billing: 'MONTHLY',
        discountValue: 50,
        discountType: 'VALUE',
        discountTotal: 50,
        downPayment: 500,
        downPaymentConditionId: 'cond-1',
        downPaymentDueDate: new Date('2024-01-10'),
        downPaymentAdditionalFee: 10,
        installmentQty: 3,
        minInstallmentQty: 1,
        maxInstallmentQty: 12,
        mainAdditionalFee: 5,
        additionalFeeType: 'PERCENTAGE',
        totalValue: 1000,
        finalValue: 950,
        description: 'Condição especial',
        commission: null,
        paymentCondition: { id: 'pc-1', name: 'À vista' },
        quotationInstallment: [
          {
            id: 'inst-1',
            dueDate: new Date('2024-02-10'),
            paymentConditionId: 'pc-1',
            additionalFee: 0,
            value: 300,
          },
        ],
      };

      const result = transformOrderPaymentConditions(payment);

      expect(result?.hasDownPayment).toBe(true);
      expect(result?.downPayment?.amount).toBe(500);
      expect(result?.installments).toHaveLength(1);
      expect(result?.installments?.[0].installmentNumber).toBe(1);
    });

    it('should set hasDownPayment to false when downPayment is 0', () => {
      const payment = {
        id: 'payment-2',
        type: 'CASH',
        billing: 'SINGLE',
        discountValue: null,
        discountType: null,
        discountTotal: null,
        downPayment: 0,
        downPaymentConditionId: null,
        downPaymentDueDate: null,
        downPaymentAdditionalFee: null,
        installmentQty: 1,
        minInstallmentQty: 1,
        maxInstallmentQty: 1,
        mainAdditionalFee: null,
        additionalFeeType: null,
        totalValue: 500,
        finalValue: 500,
        description: null,
        commission: null,
        paymentCondition: null,
        quotationInstallment: [],
      };

      const result = transformOrderPaymentConditions(payment);

      expect(result?.hasDownPayment).toBe(false);
      expect(result?.downPayment).toBeNull();
    });
  });

  // ===========================================
  // transformOrderFinancial
  // ===========================================
  describe('transformOrderFinancial', () => {
    it('should return BILLED status when receivables exist', () => {
      const result = transformOrderFinancial([{ id: 'rec-1' }], {
        totalPaid: 500,
      });

      expect(result.status).toBe('BILLED');
      expect(result.totalPaid).toBe(500);
    });

    it('should return BILLING_PENDING when no receivables', () => {
      const result = transformOrderFinancial([], { totalPaid: 0 });

      expect(result.status).toBe('BILLING_PENDING');
    });
  });

  // ===========================================
  // transformOrderToResponse (integration)
  // ===========================================
  describe('transformOrderToResponse', () => {
    it('should transform complete order structure', () => {
      const order = {
        id: 'order-1',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
        canceledAt: null,
        deliveredAt: null,
        status: 'PENDING',
        quotation: {
          id: 'quot-1',
          companyId: 'company-1',
          sellerId: 'seller-1',
          quotationNumber: 100,
          description: 'Orçamento teste',
          status: 'APPROVED',
          totalValue: 1000,
          createdAt: new Date('2024-01-01'),
          dueDate: null,
          approvedAt: new Date('2024-01-02'),
          finishedAt: null,
          quickSale: false,
          series: null,
          seller: null,
          contact: null,
          contactSource: null,
          company: null,
          client: null,
          deliveryInfo: null,
          quotationProduct: [],
          tag: null,
          quotationPayment: null,
          receivable: [],
          payable: [],
        },
        nfes: [],
      };

      const result = transformOrderToResponse(order, { totalPaid: 0 });

      expect(result.id).toBe('order-1');
      expect(result.companyId).toBe('company-1');
      expect(result.sellerId).toBe('seller-1');
      expect(result.status).toBe('PENDING');
      expect(result.quotation.id).toBe('quot-1');
      expect(result.quotation.financial.status).toBe('BILLING_PENDING');
      expect(result.nfes).toEqual([]);
    });
  });
});
