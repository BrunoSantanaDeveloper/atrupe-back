import {
  transformPdfCompany,
  transformPdfClient,
  transformPdfContact,
  transformPdfQuotationInfo,
  transformPdfOrder,
  transformPdfQuotationItem,
  transformPdfDelivery,
  transformPdfPayment,
  transformPdfTotal,
  transformQuotationToPdfData,
} from './quotation-pdf.transformers';

describe('QuotationPdfTransformers', () => {
  describe('transformPdfCompany', () => {
    it('should transform company data with address', () => {
      const company = {
        name: 'Test Company',
        cnpj: '12.345.678/0001-90',
        email: 'test@company.com',
        siteUrl: 'https://company.com',
        logoUrl: 'https://company.com/logo.png',
        textBeforeItems: 'Before items text',
        textAfterItems: 'After items text',
        instagram: '@company',
        facebook: 'company',
        linkedin: 'company-inc',
        address: [
          {
            street: 'Test Street',
            number: '123',
            complement: 'Suite 1',
            neighborhood: 'Downtown',
            city: 'Test City',
            state: 'TS',
            zipcode: '12345-678',
          },
        ],
      };

      const result = transformPdfCompany(company);

      expect(result.name).toBe('Test Company');
      expect(result.cnpj).toBe('12.345.678/0001-90');
      expect(result.email).toBe('test@company.com');
      expect(result.address).toEqual({
        street: 'Test Street',
        number: '123',
        complement: 'Suite 1',
        neighborhood: 'Downtown',
        city: 'Test City',
        state: 'TS',
        zipCode: '12345-678',
      });
      expect(result.socialNetworks).toEqual({
        instagram: '@company',
        facebook: 'company',
        linkedin: 'company-inc',
      });
    });

    it('should return null address when no address provided', () => {
      const company = {
        name: 'Test Company',
        cnpj: null,
        email: null,
        siteUrl: null,
        logoUrl: null,
        textBeforeItems: null,
        textAfterItems: null,
        instagram: null,
        facebook: null,
        linkedin: null,
        address: [],
      };

      const result = transformPdfCompany(company);

      expect(result.address).toBeNull();
    });
  });

  describe('transformPdfClient', () => {
    it('should transform PERSON client correctly', () => {
      const client = {
        name: 'John Doe',
        type: 'PERSON',
        cpf: '123.456.789-00',
        cnpj: null,
        phone: '11999999999',
        email: 'john@example.com',
        notes: 'Test notes',
        financialNotes: 'Financial notes',
        address: [
          {
            street: 'Client Street',
            number: '456',
            complement: null,
            neighborhood: 'Suburb',
            city: 'Client City',
            state: 'CS',
            zipcode: '98765-432',
          },
        ],
        contacts: [],
      };

      const result = transformPdfClient(client);

      expect(result?.document.type).toBe('CPF');
      expect(result?.document.value).toBe('123.456.789-00');
      expect(result?.address?.type).toBe('PRINCIPAL');
    });

    it('should transform COMPANY client correctly', () => {
      const client = {
        name: 'Test Corp',
        type: 'COMPANY',
        cpf: null,
        cnpj: '12.345.678/0001-90',
        phone: '11888888888',
        email: 'corp@example.com',
        notes: null,
        financialNotes: null,
        address: [],
        contacts: [],
      };

      const result = transformPdfClient(client);

      expect(result?.document.type).toBe('CNPJ');
      expect(result?.document.value).toBe('12.345.678/0001-90');
      expect(result?.address).toBeNull();
    });

    it('should return null for null client', () => {
      const result = transformPdfClient(null);
      expect(result).toBeNull();
    });
  });

  describe('transformPdfContact', () => {
    it('should transform first contact', () => {
      const client = {
        name: 'Test Client',
        type: 'PERSON',
        cpf: null,
        cnpj: null,
        phone: null,
        email: null,
        notes: null,
        financialNotes: null,
        address: [],
        contacts: [
          {
            name: 'Contact Person',
            phone: '11777777777',
            email: 'contact@example.com',
            notes: 'Primary contact',
          },
        ],
      };

      const result = transformPdfContact(client);

      expect(result).toEqual({
        name: 'Contact Person',
        phone: '11777777777',
        email: 'contact@example.com',
        notes: 'Primary contact',
      });
    });

    it('should return null when no contacts', () => {
      const client = {
        name: 'Test Client',
        type: 'PERSON',
        cpf: null,
        cnpj: null,
        phone: null,
        email: null,
        notes: null,
        financialNotes: null,
        address: [],
        contacts: [],
      };

      const result = transformPdfContact(client);
      expect(result).toBeNull();
    });
  });

  describe('transformPdfQuotationInfo', () => {
    it('should transform quotation info correctly', () => {
      const quotation = {
        id: 'test-id',
        companyId: 'company-id',
        clientId: 'client-id',
        quotationNumber: 12345,
        description: 'Test quotation',
        status: 'APPROVED',
        totalValue: 1000,
        createdAt: new Date('2026-01-15'),
        dueDate: new Date('2026-02-15'),
        approvedAt: new Date('2026-01-20'),
        finishedAt: null,
        company: {} as any,
        seller: {
          name: 'John Seller',
          signatureUrl: 'https://example.com/signature.png',
        },
        series: {
          code: 'A',
          title: 'Series A',
        },
        quotationProduct: [],
      };

      const result = transformPdfQuotationInfo(quotation);

      expect(result.number).toBe(12345);
      expect(result.seriesCode).toBe('A');
      expect(result.description).toBe('Test quotation');
      expect(result.seller.name).toBe('John Seller');
      expect(result.status).toBe('APPROVED');
    });
  });

  describe('transformPdfOrder', () => {
    it('should transform order correctly', () => {
      const order = {
        id: 'order-id',
        createdAt: new Date('2026-01-20'),
        status: 'ACTIVE',
      };
      const approvedAt = new Date('2026-01-20');

      const result = transformPdfOrder(order, approvedAt);

      expect(result?.id).toBe('order-id');
      expect(result?.status).toBe('ACTIVE');
      expect(result?.approvedAt).toEqual(approvedAt);
    });

    it('should return null for null order', () => {
      const result = transformPdfOrder(null, null);
      expect(result).toBeNull();
    });
  });

  describe('transformPdfQuotationItem', () => {
    it('should transform quotation item correctly', () => {
      const item = {
        id: 'qp-id',
        productId: 'product-id',
        description: 'Test product',
        allowEditDescription: true,
        allowEditValues: false,
        technicalDescription: 'Tech desc',
        notes: 'Notes',
        discountType: 'PERCENTAGE',
        discount: 10,
        quantity: 2,
        finalValue: 180,
        imageUrl: null,
        product: {
          name: 'Product Name',
          imageUrl: 'https://example.com/product.png',
          technicalDescription: 'Original tech desc',
        },
        items: [
          {
            id: 'item-1',
            productItemId: 'pi-1',
            name: 'Item 1',
            quantity: 1,
            originalQuantity: 1,
            unitCost: 50,
            totalValue: 50,
            weight: 1,
            width: 10,
            height: 10,
            duration: null,
            length: 10,
            distance: null,
            volume: 1000,
          },
          {
            id: 'item-2',
            productItemId: 'pi-2',
            name: 'Item 2',
            quantity: 1,
            originalQuantity: 1,
            unitCost: 50,
            totalValue: 50,
            weight: 2,
            width: 20,
            height: 20,
            duration: null,
            length: 20,
            distance: null,
            volume: 8000,
          },
        ],
      };

      const result = transformPdfQuotationItem(item);

      expect(result.id).toBe('qp-id');
      expect(result.unitValue).toBe(100); // 50 + 50
      expect(result.totalValue).toBe(100); // 50 + 50
      expect(result.image.original).toBe(true);
      expect(result.product.compositions).toHaveLength(2);
    });

    it('should detect non-original image', () => {
      const item = {
        id: 'qp-id',
        productId: 'product-id',
        description: 'Test',
        allowEditDescription: false,
        allowEditValues: false,
        technicalDescription: null,
        notes: null,
        discountType: null,
        discount: 0,
        quantity: 1,
        finalValue: 100,
        imageUrl: 'https://example.com/custom.png',
        product: {
          name: 'Product',
          imageUrl: 'https://example.com/original.png',
          technicalDescription: null,
        },
        items: [],
      };

      const result = transformPdfQuotationItem(item);

      expect(result.image.original).toBe(false);
      expect(result.image.url).toBe('https://example.com/custom.png');
      expect(result.image.size).toBe('large'); // fallback when imageSize is null and not original
    });

    it('should use imageSize from database when available', () => {
      const item = {
        id: 'qp-id',
        productId: 'product-id',
        description: 'Test',
        allowEditDescription: false,
        allowEditValues: false,
        technicalDescription: null,
        notes: null,
        discountType: null,
        discount: 0,
        quantity: 1,
        finalValue: 100,
        imageUrl: 'https://example.com/custom.png',
        imageSize: 'small', // explicitly set to small
        product: {
          name: 'Product',
          imageUrl: 'https://example.com/original.png',
          technicalDescription: null,
        },
        items: [],
      };

      const result = transformPdfQuotationItem(item);

      expect(result.image.size).toBe('small');
    });

    it('should fallback to small for original images without imageSize', () => {
      const item = {
        id: 'qp-id',
        productId: 'product-id',
        description: 'Test',
        allowEditDescription: false,
        allowEditValues: false,
        technicalDescription: null,
        notes: null,
        discountType: null,
        discount: 0,
        quantity: 1,
        finalValue: 100,
        imageUrl: null,
        imageSize: null,
        product: {
          name: 'Product',
          imageUrl: 'https://example.com/original.png',
          technicalDescription: null,
        },
        items: [],
      };

      const result = transformPdfQuotationItem(item);

      expect(result.image.original).toBe(true);
      expect(result.image.size).toBe('small');
    });
  });

  describe('transformPdfDelivery', () => {
    it('should transform delivery info with supplier', () => {
      const deliveryInfo = {
        supplier: {
          name: 'Supplier Corp',
          cnpj: '11.111.111/0001-11',
          notes: 'Supplier notes',
          financialNotes: 'Financial notes',
        },
        daysAfterApproval: 5,
        estimatedDate: new Date('2026-02-01'),
        cost: 50,
        value: 75,
        notes: 'Delivery notes',
        clientAddressId: 'address-id',
        clientAddress: {
          type: 'DELIVERY',
          street: 'Delivery Street',
          number: '789',
          complement: 'Floor 2',
          neighborhood: 'Industrial',
          city: 'Delivery City',
          state: 'DC',
          zipcode: '11111-222',
        },
      };

      const result = transformPdfDelivery(deliveryInfo);

      expect(result?.supplier?.name).toBe('Supplier Corp');
      expect(result?.freightCost).toBe(50);
      expect(result?.freightPrice).toBe(75);
      expect(result?.clientAddress?.zipCode).toBe('11111-222');
    });

    it('should return null for null delivery info', () => {
      const result = transformPdfDelivery(null);
      expect(result).toBeNull();
    });
  });

  describe('transformPdfPayment', () => {
    it('should transform payment info with down payment', () => {
      const payment = {
        paymentCondition: {
          name: '30/60/90',
        },
        description: 'Payment description',
        quotationInstallment: [
          {
            id: 1,
            dueDate: new Date('2026-02-01'),
            value: 333.33,
            paymentCondition: { name: 'PIX' },
          },
          {
            id: 2,
            dueDate: new Date('2026-03-01'),
            value: 333.33,
            paymentCondition: { name: 'PIX' },
          },
          {
            id: 3,
            dueDate: new Date('2026-04-01'),
            value: 333.34,
            paymentCondition: { name: 'PIX' },
          },
        ],
        downPayment: 100,
        downPaymentDueDate: new Date('2026-01-25'),
        downPaymentAdditionalFee: 0,
        downPaymentConditionId: 'cond-id',
        downPaymentCondition: {
          id: 'cond-id',
          name: 'PIX Antecipado',
          paymentMethod: { name: 'PIX' },
        },
      };

      const result = transformPdfPayment(payment);

      expect(result?.condition).toBe('30/60/90');
      expect(result?.totalInstallments).toBe(3);
      expect(result?.hasDownPayment).toBe(true);
      expect(result?.downPayment?.amount).toBe(100);
    });

    it('should return null for null payment', () => {
      const result = transformPdfPayment(null);
      expect(result).toBeNull();
    });
  });

  describe('transformPdfTotal', () => {
    it('should calculate totals correctly', () => {
      const quotation = {
        id: 'test',
        companyId: 'comp',
        clientId: 'client',
        quotationNumber: 1,
        description: null,
        status: 'DRAFT',
        totalValue: 1000,
        createdAt: new Date(),
        dueDate: null,
        approvedAt: null,
        finishedAt: null,
        company: {} as any,
        seller: { name: null, signatureUrl: null },
        quotationProduct: [],
        quotationPayment: {
          discountTotal: 100,
        },
      };

      const result = transformPdfTotal(quotation);

      expect(result.subtotal).toBe(1000);
      expect(result.totalDiscount).toBe(100);
      expect(result.finalTotal).toBe(900);
    });
  });

  describe('transformQuotationToPdfData', () => {
    it('should combine all transformations', () => {
      const quotation = {
        id: 'test-id',
        companyId: 'company-id',
        clientId: 'client-id',
        quotationNumber: 1,
        description: 'Test',
        status: 'DRAFT',
        totalValue: 1000,
        createdAt: new Date(),
        dueDate: null,
        approvedAt: null,
        finishedAt: null,
        company: {
          name: 'Company',
          cnpj: null,
          email: null,
          siteUrl: null,
          logoUrl: null,
          textBeforeItems: null,
          textAfterItems: null,
          instagram: null,
          facebook: null,
          linkedin: null,
          address: [],
        },
        client: null,
        seller: { name: 'Seller', signatureUrl: null },
        series: null,
        order: null,
        quotationProduct: [],
        deliveryInfo: null,
        quotationPayment: null,
      };

      const result = transformQuotationToPdfData(quotation, ['PIX', 'Boleto']);

      expect(result.company.name).toBe('Company');
      expect(result.client).toBeNull();
      expect(result.quotation.number).toBe(1);
      expect(result.quotationItems).toHaveLength(0);
      expect(result.delivery).toBeNull();
      expect(result.payment).toBeNull();
    });
  });
});
