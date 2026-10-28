import { UnprocessableEntityException } from '@nestjs/common';
import {
  AiProposalDeniedError,
  AiQuotationDraftService,
  QuotationDraftPayload,
} from './ai-quotation-draft.service';

describe('AiQuotationDraftService', () => {
  const user = {
    userId: 'user-1',
    companyId: 'company-1',
    employeeId: '7f3a8d52-6a3c-4f87-9a1e-0c7b2d4e5f61',
    isAdmin: false,
  };
  const START = new Set(['ai_assistant']);
  const LITE = new Set(['ai_assistant', 'product_composition']);

  const ids = {
    pvc3: '11111111-1111-4111-8111-111111111111',
    pvc2: '22222222-2222-4222-8222-222222222222',
    banner: '33333333-3333-4333-8333-333333333333',
    base: '44444444-4444-4444-8444-444444444444',
    camiseta: '55555555-5555-4555-8555-555555555555',
    client: '66666666-6666-4666-8666-666666666666',
    quotation: '77777777-7777-4777-8777-777777777777',
  };

  const areaRow = (id: string, perM2: number) => ({
    id: `${id}-row`,
    name: 'Impressão',
    unitKind: 'AREA',
    unitCost: perM2 / 1_000_000,
    width: null,
    height: null,
    length: null,
    volume: null,
    weight: null,
    distance: null,
    duration: null,
  });

  const product = (
    overrides: { id: string; name: string } & Record<string, unknown>,
  ) => ({
    code: null,
    isActive: true,
    minQuantity: null,
    technicalDescription: null,
    sector: { name: 'Comunicação Visual' },
    variations: [],
    priceTiers: [],
    ...overrides,
  });

  const catalog = {
    pvc3: product({
      id: ids.pvc3,
      name: 'Placa PVC 3 mm',
      items: [areaRow(ids.pvc3, 9_000)],
    }),
    pvc2: product({
      id: ids.pvc2,
      name: 'Placa PVC 2 mm',
      items: [areaRow(ids.pvc2, 7_000)],
    }),
    banner: product({
      id: ids.banner,
      name: 'Banner Lona 440 g',
      minQuantity: 0.5,
      items: [areaRow(ids.banner, 10_000)],
    }),
    base: product({
      id: ids.base,
      name: 'Produto base – Comunicação Visual',
      items: [{ ...areaRow(ids.base, 0), unitKind: 'UNITY', unitCost: 0 }],
    }),
    camiseta: product({
      id: ids.camiseta,
      name: 'Camiseta personalizada',
      items: [
        { ...areaRow(ids.camiseta, 0), unitKind: 'UNITY', unitCost: 3_500 },
      ],
      variations: [
        { id: 'var-p', name: 'P', unitPrice: null },
        { id: 'var-g', name: 'G', unitPrice: 4_000 },
      ],
    }),
  };

  function makeService(options: { canSeeOthers?: boolean } = {}) {
    const products = Object.values(catalog);
    const prisma = {
      product: {
        findMany: jest.fn(async ({ where }) => {
          // Produto base: o filtro do nome; os outros: o "contains"
          const base = JSON.stringify(where).includes('"startsWith"');
          const notBase = JSON.stringify(where).includes('"NOT"');
          if (base && !notBase) return [catalog.base];
          const tokens: string[] = (where.OR ?? [])
            .map((clause) => clause.name?.contains)
            .filter(Boolean);
          return products.filter(
            (p) =>
              p.id !== ids.base &&
              tokens.some((token) => p.name.toLowerCase().includes(token)),
          );
        }),
        findFirst: jest.fn(
          async ({ where }) => products.find((p) => p.id === where.id) ?? null,
        ),
      },
      client: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: ids.client, name: 'Clínica Sorriso', tradeName: null },
          ]),
        findFirst: jest.fn().mockResolvedValue({ id: ids.client }),
      },
      contact: { findMany: jest.fn().mockResolvedValue([]) },
      saleSettings: {
        findUnique: jest.fn().mockResolvedValue({ minItemValue: 0 }),
      },
      quotation: {
        findFirst: jest.fn().mockResolvedValue({
          id: ids.quotation,
          sellerId: 'outro-vendedor',
          status: 'OPEN',
        }),
      },
      pendingSale: { findUnique: jest.fn().mockResolvedValue(null) },
      quotationProduct: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValue([{ id: 'item-novo' }]),
      },
      employee: {
        findUnique: jest.fn().mockResolvedValue({ sellerProfileId: null }),
      },
      saleSeries: { findFirst: jest.fn().mockResolvedValue({ id: 'serie-1' }) },
      contactSource: {
        findFirst: jest.fn().mockResolvedValue({ id: 'venda-direta' }),
      },
      deliveryInfo: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const abacService = {
      hasPermission: jest.fn().mockResolvedValue(true),
      canAccessOtherSellers: jest
        .fn()
        .mockResolvedValue(options.canSeeOthers ?? false),
    };
    const quotations = {
      create: jest.fn().mockResolvedValue({ id: ids.quotation }),
      addProductToQuotation: jest.fn().mockResolvedValue({}),
    };
    const service = new AiQuotationDraftService(
      prisma as any,
      abacService as any,
      quotations as any,
    );
    return { service, prisma, abacService, quotations };
  }

  const placas = {
    clientHint: 'Clínica Sorriso',
    items: [
      {
        text: '200 placas 30x40 em PVC 3mm',
        productHint: 'placa PVC 3 mm',
        quantity: 200,
      },
    ],
  };

  it('"200 placas 30x40 em PVC 3mm para a Clínica Sorriso": proposta pronta, nada gravado', async () => {
    const { service, quotations } = makeService();

    const draft = await service.build(placas, user, START);

    expect(draft.client).toEqual({
      id: ids.client,
      name: 'Clínica Sorriso',
      match: 'EXACT',
    });
    expect(draft.items).toEqual([
      expect.objectContaining({
        status: 'OK',
        productId: ids.pvc3,
        unit: 'm2',
        quantity: 200,
        width: 0.3,
        height: 0.4,
        unitPrice: 9_000,
        // 0,12 m² × 200 × R$ 90,00
        total: 216_000,
      }),
    ]);
    expect(draft.total).toBe(216_000);
    expect(quotations.create).not.toHaveBeenCalled();
    expect(quotations.addProductToQuotation).not.toHaveBeenCalled();
  });

  it('o preço que o modelo manda é ignorado', async () => {
    const { service } = makeService();

    const draft = await service.build(
      {
        ...placas,
        items: [{ ...placas.items[0], unitPrice: 1, total: 1, price: 1 }],
      },
      user,
      START,
    );

    expect(draft.items[0].unitPrice).toBe(9_000);
    expect(draft.items[0].total).toBe(216_000);
  });

  it('produto que não existe: Produto base do setor, sem criar produto', async () => {
    const { service, prisma } = makeService();

    const draft = await service.build(
      {
        items: [
          {
            text: 'totem em ACM de 2 m',
            productHint: 'totem em ACM',
            quantity: 1,
          },
        ],
      },
      user,
      START,
    );

    expect(draft.items[0]).toEqual(
      expect.objectContaining({
        status: 'BASE_PRODUCT',
        productId: ids.base,
        description: 'Totem em ACM',
        technicalDescription: 'totem em ACM de 2 m',
      }),
    );
    expect((prisma.product as any).create).toBeUndefined();
  });

  it('dois produtos parecidos: a pessoa escolhe entre os candidatos', async () => {
    const { service } = makeService();

    const draft = await service.build(
      {
        items: [
          { text: '10 placas pvc 1x1', productHint: 'placa pvc', quantity: 10 },
        ],
      },
      user,
      START,
    );

    expect(draft.items[0].status).toBe('NEEDS_CHOICE');
    expect(draft.items[0].candidates.map((c) => c.id)).toEqual([
      ids.pvc3,
      ids.pvc2,
    ]);
  });

  it('m² sem medida: NEEDS_MEASURE e o aviso do que falta', async () => {
    const { service } = makeService();

    const draft = await service.build(
      {
        items: [
          {
            text: 'banner lona com ilhós',
            productHint: 'banner lona',
            quantity: 1,
          },
        ],
      },
      user,
      START,
    );

    expect(draft.items[0]).toEqual(
      expect.objectContaining({
        status: 'NEEDS_MEASURE',
        productId: ids.banner,
      }),
    );
    expect(draft.warnings).toContain(
      'Falta a medida de "banner lona com ilhós".',
    );
  });

  it('quantidade mínima de 0,5 m² e pedido de 0,3 × 0,3 m: cobra 0,5 m², igual à tela', async () => {
    const { service } = makeService();

    const draft = await service.build(
      {
        items: [
          {
            text: 'banner 0,3 x 0,3 m',
            productHint: 'banner lona',
            quantity: 1,
          },
        ],
      },
      user,
      LITE,
    );

    expect(draft.items[0]).toEqual(
      expect.objectContaining({
        status: 'OK',
        width: 0.3,
        height: 0.3,
        total: 5_000,
        rules: ['quantidade mínima de 0,5 m²'],
      }),
    );
  });

  it('variação citada: casa com a do cadastro e usa o preço dela', async () => {
    const { service } = makeService();

    const draft = await service.build(
      {
        items: [
          {
            text: '10 camisetas G',
            productHint: 'camiseta personalizada',
            quantity: 10,
            variationHint: 'G',
          },
        ],
      },
      user,
      LITE,
    );

    expect(draft.items[0]).toEqual(
      expect.objectContaining({
        status: 'OK',
        variationId: 'var-g',
        description: 'Camiseta personalizada · G',
        total: 40_000,
      }),
    );
  });

  it('o resumo ao modelo não leva valor, documento nem id do cadastro', async () => {
    const { service } = makeService();
    const draft = await service.build(placas, user, START);

    const summary = JSON.stringify(service.summaryForModel('action-1', draft));

    expect(summary).not.toMatch(/216000|9000|unitPrice|total"|cpf|cnpj/i);
    expect(summary).not.toContain(ids.pvc3);
    expect(summary).not.toContain(ids.client);
  });

  it('sem values:values, a proposta sai sem preços', async () => {
    const { service } = makeService();
    const draft = await service.build(placas, user, START);

    const shown = service.withoutValues(draft);

    expect(shown.total).toBeUndefined();
    expect(shown.items[0].unitPrice).toBeUndefined();
    expect(shown.items[0].total).toBeUndefined();
    expect(shown.items[0].quantity).toBe(200);
  });

  it('orçamento aberto de outro vendedor: a proposta é recusada', async () => {
    const { service } = makeService({ canSeeOthers: false });

    await expect(
      service.build({ ...placas, target: 'CURRENT' }, user, START, {
        currentQuotationId: ids.quotation,
      }),
    ).rejects.toBeInstanceOf(AiProposalDeniedError);
  });

  describe('aplicar', () => {
    async function proposal(args = placas) {
      const made = makeService();
      const payload = await made.service.build(args, user, START);
      return { ...made, payload };
    }

    it('cria o orçamento com os padrões da tela e adiciona o item com o preço do servidor', async () => {
      const { service, payload, quotations, prisma } = await proposal({
        ...placas,
        deliveryDate: '2026-10-30',
        notes: 'Entregar na recepção',
      } as any);

      const result = await service.apply(payload, undefined, user, START);

      expect(quotations.create).toHaveBeenCalledWith(
        {
          companyId: 'company-1',
          sellerId: user.employeeId,
          clientId: ids.client,
          seriesId: 'serie-1',
          contactSourceId: 'venda-direta',
          description: 'Entregar na recepção',
        },
        'user-1',
        'company-1',
      );
      expect(quotations.addProductToQuotation).toHaveBeenCalledWith(
        ids.quotation,
        {
          productId: ids.pvc3,
          quantity: 1,
          description: 'Placa PVC 3 mm',
          technicalDescription: undefined,
          variationId: undefined,
          items: [
            expect.objectContaining({
              id: `${ids.pvc3}-row`,
              quantity: 200,
              width: 300,
              height: 400,
              salePrice: 216_000,
            }),
          ],
        },
      );
      expect(prisma.deliveryInfo.updateMany).toHaveBeenCalledWith({
        where: { quotationId: ids.quotation },
        data: {
          estimatedDate: new Date('2026-10-30T12:00:00-03:00'),
          deliveryDisplayMode: 'DATE',
        },
      });
      expect(result).toEqual({
        status: 'APPLIED',
        quotationId: ids.quotation,
        itemIds: ['item-novo'],
        warnings: [],
      });
    });

    it('item sem medida recusa o aplicar com a lista do que falta', async () => {
      const { service, payload, quotations } = await proposal({
        items: [
          {
            text: 'banner lona com ilhós',
            productHint: 'banner lona',
            quantity: 1,
          },
        ],
      } as any);

      const error = await service
        .apply(payload, { clientId: ids.client }, user, START)
        .catch((e) => e);

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect(error.getResponse()).toEqual(
        expect.objectContaining({
          missing: [
            expect.objectContaining({ index: 0, status: 'NEEDS_MEASURE' }),
          ],
        }),
      );
      expect(quotations.create).not.toHaveBeenCalled();
    });

    it('com a medida preenchida no cartão, aplica', async () => {
      const { service, payload, quotations } = await proposal({
        items: [
          {
            text: 'banner lona com ilhós',
            productHint: 'banner lona',
            quantity: 1,
          },
        ],
      } as any);

      await service.apply(
        payload,
        { clientId: ids.client, items: [{ index: 0, width: 2, height: 1 }] },
        user,
        START,
      );

      expect(quotations.addProductToQuotation).toHaveBeenCalledWith(
        ids.quotation,
        expect.objectContaining({
          items: [
            expect.objectContaining({
              width: 2000,
              height: 1000,
              salePrice: 20_000,
            }),
          ],
        }),
      );
    });

    it('sem cliente, recusa: o orçamento comum precisa de cliente', async () => {
      const { service, payload, quotations } = await proposal({
        items: placas.items,
      } as any);
      const payloadSemCliente: QuotationDraftPayload = {
        ...payload,
        client: { id: null, name: null, match: 'NONE' },
      };

      await expect(
        service.apply(payloadSemCliente, undefined, user, START),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(quotations.create).not.toHaveBeenCalled();
    });
  });
});
