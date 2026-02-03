import {
  transformSeries,
  transformSeller,
  transformContact,
  transformCompany,
  transformClient,
  transformDeliveryInfo,
  transformPaymentConditions,
  transformQuotationItem,
  transformQuotationItems,
  transformQuotationToResponse,
} from './quotation.transformers';

describe('Quotation Transformers', () => {
  describe('transformSeries', () => {
    it('should return null if series is null', () => {
      expect(transformSeries(null, 1)).toBeNull();
    });

    it('should transform series correctly', () => {
      const series = { id: 'series-1', title: 'Série A', code: 'SA' };
      const result = transformSeries(series, 42);

      expect(result).toEqual({
        id: 'series-1',
        name: 'Série A',
        code: 'SA',
        quotation: 42,
      });
    });
  });

  describe('transformSeller', () => {
    it('should return null if seller is null', () => {
      expect(transformSeller(null)).toBeNull();
    });

    it('should use seller name when available', () => {
      const seller = {
        id: 'seller-1',
        name: 'João Vendedor',
        user: { id: 'user-1', name: 'João User' },
        sellerProfile: { maxDiscount: 15 },
      };
      const result = transformSeller(seller);

      expect(result).toEqual({
        id: 'seller-1',
        name: 'João Vendedor',
        maxDiscount: 15,
      });
    });

    it('should fallback to user name when seller name is null', () => {
      const seller = {
        id: 'seller-1',
        name: null,
        user: { id: 'user-1', name: 'João User' },
        sellerProfile: null,
      };
      const result = transformSeller(seller);

      expect(result).toEqual({
        id: 'seller-1',
        name: 'João User',
        maxDiscount: null,
      });
    });
  });

  describe('transformContact', () => {
    it('should return null if contact is null', () => {
      expect(transformContact(null)).toBeNull();
    });

    it('should transform contact correctly', () => {
      const contact = { id: 'contact-1', name: 'Maria Contato' };
      expect(transformContact(contact)).toEqual({
        id: 'contact-1',
        name: 'Maria Contato',
      });
    });
  });

  describe('transformCompany', () => {
    it('should return null if subCompany is null', () => {
      expect(transformCompany(null)).toBeNull();
    });

    it('should transform company correctly', () => {
      const company = {
        id: 'company-1',
        name: 'Empresa XYZ',
        cnpj: '12.345.678/0001-90',
      };
      expect(transformCompany(company)).toEqual({
        id: 'company-1',
        name: 'Empresa XYZ',
        cnpj: '12.345.678/0001-90',
      });
    });
  });

  describe('transformClient', () => {
    it('should return null if client is null', () => {
      expect(transformClient(null)).toBeNull();
    });

    it('should transform client correctly with phone mapped to phoneNumber', () => {
      const client = {
        id: 'client-1',
        type: 'PJ',
        name: 'Cliente ABC',
        status: 'ACTIVE',
        cnpj: '98.765.432/0001-10',
        cpf: null,
        email: 'cliente@abc.com',
        phone: '11999998888',
      };
      const result = transformClient(client);

      expect(result).toEqual({
        id: 'client-1',
        type: 'PJ',
        name: 'Cliente ABC',
        status: 'ACTIVE',
        cnpj: '98.765.432/0001-10',
        cpf: null,
        email: 'cliente@abc.com',
        phoneNumber: '11999998888',
      });
    });
  });

  describe('transformDeliveryInfo', () => {
    it('should return null if deliveryInfo is null', () => {
      expect(transformDeliveryInfo(null)).toBeNull();
    });

    it('should transform delivery info correctly', () => {
      const deliveryInfo = {
        id: 'delivery-1',
        deliveryType: 'CARRIER',
        daysAfterApproval: 15,
        estimatedDate: new Date('2026-03-01'),
        cost: 150.0,
        value: 200.0,
        notes: 'Entrega expressa',
        modality: 'CIF',
        clientAddressId: 'addr-1',
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-15'),
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
        supplier: {
          id: 'supplier-1',
          name: 'Transportadora XYZ',
        },
      };
      const result = transformDeliveryInfo(deliveryInfo);

      expect(result.id).toBe('delivery-1');
      expect(result.type).toBe('CARRIER');
      expect(result.timeFrame).toBe(15);
      expect(result.clientAddress.street).toBe('Rua das Flores');
      expect(result.supplier.name).toBe('Transportadora XYZ');
    });

    it('should handle null clientAddress and supplier', () => {
      const deliveryInfo = {
        id: 'delivery-1',
        deliveryType: 'PICKUP',
        daysAfterApproval: null,
        estimatedDate: null,
        cost: 0,
        value: 0,
        notes: null,
        modality: null,
        clientAddressId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        clientAddress: null,
        supplier: null,
      };
      const result = transformDeliveryInfo(deliveryInfo);

      expect(result.clientAddress).toBeNull();
      expect(result.supplier).toBeNull();
    });
  });

  describe('transformPaymentConditions', () => {
    it('should return null if quotationPayment is null', () => {
      expect(transformPaymentConditions(null)).toBeNull();
    });

    it('should transform payment conditions with default values', () => {
      const payment = {
        id: 'payment-1',
        type: 'CREDIT',
        billing: 'ON_DELIVERY',
        discountValue: null,
        discountType: null,
        discountTotal: null,
        installmentQty: 3,
        minInstallmentQty: 1,
        maxInstallmentQty: 12,
        mainAdditionalFee: 2.5,
        additionalFeeType: 'PERCENTAGE',
        downPayment: 0,
        downPaymentDueDate: null,
        downPaymentAdditionalFee: null,
        downPaymentConditionId: null,
        paymentCondition: { id: 'cond-1', name: 'Cartão 3x' },
        totalValue: 1000,
        finalValue: 1025,
        description: 'Pagamento em 3x',
        commission: null,
        quotationInstallment: [],
      };
      const result = transformPaymentConditions(payment);

      expect(result.discount.discountValue).toBe(0);
      expect(result.discount.discountType).toBe('VALUE');
      expect(result.hasDownPayment).toBe(false);
      expect(result.downPayment).toBeNull();
      expect(result.commission).toBeNull();
      expect(result.installments).toBeNull();
    });

    it('should transform payment with downPayment and installments', () => {
      const payment = {
        id: 'payment-1',
        type: 'CREDIT',
        billing: 'ON_ORDER',
        discountValue: 100,
        discountType: 'VALUE',
        discountTotal: 100,
        installmentQty: 2,
        minInstallmentQty: 1,
        maxInstallmentQty: 6,
        mainAdditionalFee: 0,
        additionalFeeType: 'FIXED',
        downPayment: 500,
        downPaymentDueDate: new Date('2026-02-01'),
        downPaymentAdditionalFee: 0,
        downPaymentConditionId: 'cond-pix',
        paymentCondition: { id: 'cond-1', name: 'PIX + 2x' },
        totalValue: 2000,
        finalValue: 1900,
        description: 'Entrada + 2x',
        commission: {
          type: 'ADDITION',
          supplier: { id: 'sup-1', name: 'Parceiro' },
          transferMethod: 'PIX',
          commissionValue: 5,
          commissionType: 'PERCENTAGE',
          totalCommission: 95,
        },
        quotationInstallment: [
          {
            id: 'inst-1',
            dueDate: new Date('2026-03-01'),
            paymentConditionId: 'cond-1',
            additionalFee: 0,
            value: 700,
          },
          {
            id: 'inst-2',
            dueDate: new Date('2026-04-01'),
            paymentConditionId: 'cond-1',
            additionalFee: 0,
            value: 700,
          },
        ],
      };
      const result = transformPaymentConditions(payment);

      expect(result.hasDownPayment).toBe(true);
      expect(result.downPayment.amount).toBe(500);
      expect(result.commission.supplier.name).toBe('Parceiro');
      expect(result.installments).toHaveLength(2);
      expect(result.installments[0].installmentNumber).toBe(1);
      expect(result.installments[1].installmentNumber).toBe(2);
    });
  });

  describe('transformQuotationItem', () => {
    it('should transform quotation item correctly', () => {
      const qp = {
        id: 'qp-1',
        description: 'Produto Teste',
        allowEditDescription: true,
        allowEditValues: false,
        technicalDescription: 'Descrição técnica',
        notes: 'Observações',
        discountType: 'PERCENTAGE',
        discount: 10,
        finalValue: 900,
        imageUrl: 'https://example.com/custom.jpg',
        productId: 'prod-1',
        quantity: 2,
        product: {
          name: 'Produto Original',
          imageUrl: 'https://example.com/original.jpg',
        },
        items: [
          {
            id: 'item-1',
            productItemId: 'pi-1',
            name: 'Item 1',
            unitKind: 'UN',
            quantity: 2,
            originalQuantity: 2,
            unitCost: 200,
            totalValue: 400,
            weight: 1,
            width: 10,
            height: 5,
            duration: null,
            length: null,
            distance: null,
            volume: null,
          },
          {
            id: 'item-2',
            productItemId: 'pi-2',
            name: 'Item 2',
            unitKind: 'UN',
            quantity: 1,
            originalQuantity: 1,
            unitCost: 300,
            totalValue: 300,
            weight: 2,
            width: 20,
            height: 10,
            duration: null,
            length: null,
            distance: null,
            volume: null,
          },
        ],
      };
      const result = transformQuotationItem(qp);

      expect(result.id).toBe('qp-1');
      expect(result.unitValue).toBe(500); // 200 + 300
      expect(result.totalValue).toBe(700); // 400 + 300
      expect(result.image.url).toBe('https://example.com/custom.jpg');
      expect(result.image.original).toBe(false);
      expect(result.product.compositions).toHaveLength(2);
    });

    it('should use original image when no custom image', () => {
      const qp = {
        id: 'qp-1',
        description: 'Produto',
        allowEditDescription: false,
        allowEditValues: false,
        technicalDescription: null,
        notes: null,
        discountType: null,
        discount: 0,
        finalValue: 100,
        imageUrl: null,
        productId: 'prod-1',
        quantity: 1,
        product: {
          name: 'Produto',
          imageUrl: 'https://example.com/original.jpg',
        },
        items: [
          {
            id: 'item-1',
            productItemId: 'pi-1',
            name: 'Item',
            unitKind: 'UN',
            quantity: 1,
            originalQuantity: 1,
            unitCost: 100,
            totalValue: 100,
            weight: null,
            width: null,
            height: null,
            duration: null,
            length: null,
            distance: null,
            volume: null,
          },
        ],
      };
      const result = transformQuotationItem(qp);

      expect(result.image.url).toBe('https://example.com/original.jpg');
      expect(result.image.original).toBe(true);
    });
  });

  describe('transformQuotationItems', () => {
    it('should transform array of quotation products', () => {
      const products = [
        {
          id: 'qp-1',
          description: 'P1',
          allowEditDescription: false,
          allowEditValues: false,
          technicalDescription: null,
          notes: null,
          discountType: null,
          discount: 0,
          finalValue: 100,
          imageUrl: null,
          productId: 'prod-1',
          quantity: 1,
          product: { name: 'P1', imageUrl: null },
          items: [
            {
              id: 'i1',
              productItemId: 'pi1',
              name: 'I1',
              unitKind: 'UN',
              quantity: 1,
              originalQuantity: 1,
              unitCost: 100,
              totalValue: 100,
              weight: null,
              width: null,
              height: null,
              duration: null,
              length: null,
              distance: null,
              volume: null,
            },
          ],
        },
        {
          id: 'qp-2',
          description: 'P2',
          allowEditDescription: false,
          allowEditValues: false,
          technicalDescription: null,
          notes: null,
          discountType: null,
          discount: 0,
          finalValue: 200,
          imageUrl: null,
          productId: 'prod-2',
          quantity: 1,
          product: { name: 'P2', imageUrl: null },
          items: [
            {
              id: 'i2',
              productItemId: 'pi2',
              name: 'I2',
              unitKind: 'UN',
              quantity: 1,
              originalQuantity: 1,
              unitCost: 200,
              totalValue: 200,
              weight: null,
              width: null,
              height: null,
              duration: null,
              length: null,
              distance: null,
              volume: null,
            },
          ],
        },
      ];
      const result = transformQuotationItems(products);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('qp-1');
      expect(result[1].id).toBe('qp-2');
    });
  });

  describe('transformQuotationToResponse', () => {
    const baseQuotation = {
      id: 'quot-1',
      companyId: 'comp-1',
      sellerId: 'seller-1',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-15'),
      dueDate: null,
      finishedAt: null,
      description: 'Orçamento teste',
      status: 'DRAFT',
      totalValue: 1000,
      quickSale: false,
      quotationNumber: 42,
      order: null,
      series: null,
      seller: null,
      contact: null,
      contactSource: null,
      subCompany: null,
      client: null,
      deliveryInfo: null,
      quotationPayment: null,
      quotationProduct: [],
    };

    it('should transform basic quotation', () => {
      const result = transformQuotationToResponse(baseQuotation);

      expect(result.id).toBe('quot-1');
      expect(result.status).toBe('DRAFT');
      expect(result.orderId).toBeNull();
      expect(result.quickSale).toBe(false);
    });

    it('should mark quotation as OVERDUE when past dueDate and status DONE', () => {
      const overdueQuotation = {
        ...baseQuotation,
        status: 'DONE',
        dueDate: new Date('2020-01-01'), // past date
      };
      const result = transformQuotationToResponse(overdueQuotation);

      expect(result.status).toBe('OVERDUE');
    });

    it('should NOT mark as OVERDUE if status is not DONE', () => {
      const quotation = {
        ...baseQuotation,
        status: 'DRAFT',
        dueDate: new Date('2020-01-01'), // past date
      };
      const result = transformQuotationToResponse(quotation);

      expect(result.status).toBe('DRAFT');
    });

    it('should include orderId when order exists', () => {
      const quotation = {
        ...baseQuotation,
        order: { id: 'order-123' },
      };
      const result = transformQuotationToResponse(quotation);

      expect(result.orderId).toBe('order-123');
    });
  });
});
