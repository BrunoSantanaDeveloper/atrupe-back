import {
  AiOperationalQueryDeniedError,
  AiOperationalQueryService,
} from './ai-operational-query.service';

describe('AiOperationalQueryService', () => {
  const user = {
    userId: 'user-1',
    companyId: 'company-1',
    role: 'role-1',
    isAdmin: false,
    isSystemAdmin: false,
  };

  function makeService(hasPermission = jest.fn().mockResolvedValue(true)) {
    const prisma = {
      order: {
        groupBy: jest.fn().mockResolvedValue([]),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      quotation: {
        groupBy: jest.fn().mockResolvedValue([]),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      receivableInstallment: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      payableInstallment: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      nfe: {
        groupBy: jest.fn().mockResolvedValue([]),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      nfse: {
        groupBy: jest.fn().mockResolvedValue([]),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      nfce: {
        groupBy: jest.fn().mockResolvedValue([]),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const abacService = { hasPermission };

    return {
      service: new AiOperationalQueryService(prisma as any, abacService as any),
      prisma,
      hasPermission,
    };
  }

  it('conta OS canceladas usando companyId do JWT e ignora companyId enviado pelo modelo', async () => {
    const { service, prisma } = makeService();
    prisma.order.groupBy.mockResolvedValue([{ status: 'CANCELED', _count: 3 }]);

    const result = await service.query(
      {
        entity: 'orders',
        metric: 'count',
        companyId: 'evil-company',
        filters: {
          companyId: 'evil-company',
          status: 'CANCELED',
          arbitrarySql: 'select * from orders',
        },
      },
      { ...user, isAdmin: true },
    );

    expect(result).toEqual(
      expect.objectContaining({
        entity: 'orders',
        metric: 'count',
        filters: { status: 'CANCELED' },
        total: 3,
      }),
    );
    expect(prisma.order.groupBy).toHaveBeenCalledWith({
      by: ['status'],
      where: {
        isActive: true,
        status: 'CANCELED',
        quotation: { companyId: 'company-1' },
      },
      _count: true,
    });
  });

  it('forca escopo do proprio vendedor quando o perfil nao pode consultar terceiros', async () => {
    const hasPermission = jest
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const { service, prisma } = makeService(hasPermission);

    await service.query(
      {
        entity: 'orders',
        metric: 'count',
        filters: { sellerId: 'other-seller' },
      },
      { ...user, employeeId: 'employee-1' },
    );

    expect(prisma.order.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          quotation: expect.objectContaining({
            companyId: 'company-1',
            sellerId: 'employee-1',
          }),
        }),
      }),
    );
  });

  it('aplica periodo de cancelamento usando canceledAt', async () => {
    const { service, prisma } = makeService();

    await service.query(
      {
        entity: 'orders',
        metric: 'count',
        filters: {
          status: 'CANCELED',
          dateField: 'canceledAt',
          startDate: '2026-06-01',
          endDate: '2026-06-30',
        },
      },
      { ...user, isAdmin: true },
    );

    const where = prisma.order.groupBy.mock.calls[0][0].where;
    expect(where.canceledAt.gte).toEqual(
      new Date('2026-06-01T00:00:00.000-03:00'),
    );
    expect(where.canceledAt.lte).toEqual(
      new Date('2026-06-30T23:59:59.999-03:00'),
    );
  });

  it('nega consulta sem permissao da entidade', async () => {
    const { service, prisma } = makeService(jest.fn().mockResolvedValue(false));

    await expect(
      service.query({ entity: 'orders', metric: 'count' }, user),
    ).rejects.toBeInstanceOf(AiOperationalQueryDeniedError);
    expect(prisma.order.groupBy).not.toHaveBeenCalled();
  });

  it('rejeita entidade fora do catalogo', async () => {
    const { service, prisma } = makeService();

    await expect(
      service.query({ entity: 'users', metric: 'count' }, user),
    ).rejects.toThrow('Entidade operacional nao permitida.');
    expect(prisma.order.groupBy).not.toHaveBeenCalled();
    expect(prisma.quotation.groupBy).not.toHaveBeenCalled();
  });

  it('consulta orcamentos pelo mesmo contrato sem criar ferramenta adicional', async () => {
    const { service, prisma } = makeService();
    prisma.quotation.groupBy.mockResolvedValue([{ status: 'OPEN', _count: 5 }]);

    const result = await service.query(
      {
        entity: 'quotations',
        metric: 'count',
        filters: { status: 'OPEN' },
      },
      { ...user, isAdmin: true },
    );

    expect(result).toEqual(
      expect.objectContaining({
        entity: 'quotations',
        total: 5,
      }),
    );
    expect(prisma.quotation.groupBy).toHaveBeenCalledWith({
      by: ['status'],
      where: {
        isActive: true,
        companyId: 'company-1',
        status: 'OPEN',
      },
      _count: true,
    });
  });

  it('busca lista resumida com limite maximo e escopo da empresa logada', async () => {
    const { service, prisma } = makeService();
    prisma.order.findMany.mockResolvedValue([
      {
        id: 'order-1',
        status: 'CANCELED',
        createdAt: new Date('2026-06-01T12:00:00.000Z'),
        canceledAt: new Date('2026-06-02T12:00:00.000Z'),
        deliveredAt: null,
        quotation: {
          id: 'quotation-1',
          quotationNumber: 10,
          description: 'Pedido teste',
          status: 'APPROVED',
          createdAt: new Date('2026-06-01T12:00:00.000Z'),
          dueDate: null,
          client: { id: 'client-1', name: 'Cliente teste' },
          seller: { id: 'employee-1', name: 'Vendedor teste' },
        },
      },
    ]);

    const result = await service.search(
      {
        entity: 'orders',
        limit: 999,
        filters: {
          status: 'CANCELED',
          search: 'Pedido',
          companyId: 'evil-company',
        },
      },
      { ...user, isAdmin: true },
    );

    expect(result.limit).toBe(10);
    expect(result.records).toHaveLength(1);
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'CANCELED',
          quotation: expect.objectContaining({
            companyId: 'company-1',
            OR: expect.any(Array),
          }),
        }),
        take: 10,
      }),
    );
  });

  it('consulta detalhe somente dentro do escopo autorizado', async () => {
    const { service, prisma } = makeService();
    prisma.quotation.findFirst.mockResolvedValue({
      id: 'quotation-1',
      quotationNumber: 10,
      description: 'Orcamento teste',
      status: 'OPEN',
      createdAt: new Date('2026-06-01T12:00:00.000Z'),
      dueDate: null,
      client: null,
      seller: { id: 'employee-1', name: 'Vendedor teste' },
    });

    const result = await service.details(
      { entity: 'quotations', id: 'quotation-1', companyId: 'evil-company' },
      { ...user, isAdmin: true },
    );

    expect(result.record).toEqual(
      expect.objectContaining({ id: 'quotation-1', status: 'OPEN' }),
    );
    expect(prisma.quotation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'quotation-1',
          companyId: 'company-1',
        }),
      }),
    );
  });

  it('soma recebiveis por vencimento usando empresa do JWT e permissao de valores', async () => {
    const { service, prisma, hasPermission } = makeService();
    prisma.receivableInstallment.findMany.mockResolvedValue([
      {
        id: 'receivable-installment-1',
        installmentNumber: 1,
        status: 'PENDING',
        dueDate: new Date('2099-06-15T12:00:00.000Z'),
        paidDate: null,
        provisionDate: null,
        amount: 150,
        paidAmount: null,
        additionalFee: null,
      },
      {
        id: 'receivable-installment-2',
        installmentNumber: 2,
        status: 'PAID',
        dueDate: new Date('2099-06-20T12:00:00.000Z'),
        paidDate: new Date('2099-06-20T12:00:00.000Z'),
        provisionDate: null,
        amount: 100,
        paidAmount: 90,
        additionalFee: null,
      },
    ]);

    const result = await service.query(
      {
        entity: 'receivables',
        metric: 'sum',
        filters: {
          companyId: 'evil-company',
          startDate: '2099-06-01',
          endDate: '2099-06-30',
        },
      },
      user,
    );

    expect(result).toEqual(
      expect.objectContaining({
        entity: 'receivables',
        metric: 'sum',
        dateField: 'dueDate',
        totalCount: 2,
        totalValue: 240,
        total: 240,
      }),
    );
    expect(hasPermission).toHaveBeenCalledWith(user, 'view', 'financial:flow');
    expect(hasPermission).toHaveBeenCalledWith(user, 'view', 'values:values');
    expect(prisma.receivableInstallment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          receivable: {
            companyId: 'company-1',
            status: { not: 'CANCELED' },
          },
          status: { not: 'CANCELED' },
          dueDate: {
            gte: new Date('2099-06-01T00:00:00.000-03:00'),
            lte: new Date('2099-06-30T23:59:59.999-03:00'),
          },
        },
      }),
    );
  });

  it('nega consulta financeira quando faltar permissao para visualizar valores', async () => {
    const hasPermission = jest
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const { service, prisma } = makeService(hasPermission);

    await expect(
      service.query({ entity: 'receivables', metric: 'sum' }, user),
    ).rejects.toBeInstanceOf(AiOperationalQueryDeniedError);
    expect(prisma.receivableInstallment.findMany).not.toHaveBeenCalled();
  });

  it('usa mes atual no timezone do projeto como periodo financeiro padrao', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-15T12:00:00.000Z'));
    const { service, prisma } = makeService();

    try {
      const result = await service.query(
        { entity: 'payables', metric: 'count' },
        user,
      );

      expect(result.period).toEqual({
        startDate: '2026-06-01',
        endDate: '2026-06-30',
      });
      expect(prisma.payableInstallment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            dueDate: {
              gte: new Date('2026-06-01T00:00:00.000-03:00'),
              lte: new Date('2026-06-30T23:59:59.999-03:00'),
            },
          }),
        }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('busca despesas resumidas com fornecedor e empresa autenticada', async () => {
    const { service, prisma } = makeService();
    prisma.payableInstallment.findMany.mockResolvedValue([
      {
        id: 'payable-installment-1',
        installmentNumber: 1,
        status: 'PENDING',
        dueDate: new Date('2099-06-15T12:00:00.000Z'),
        paidDate: null,
        provisionDate: null,
        amount: 80,
        paidAmount: null,
        additionalFee: null,
        payable: {
          id: 'payable-1',
          description: 'Energia eletrica',
          reference: 'JUN-2099',
          supplier: { id: 'supplier-1', name: 'Fornecedor teste' },
        },
      },
    ]);

    const result = await service.search(
      {
        entity: 'payables',
        filters: {
          search: 'Energia',
          supplierId: 'supplier-1',
          companyId: 'evil-company',
        },
      },
      user,
    );

    expect(result.records[0]).toEqual(
      expect.objectContaining({
        id: 'payable-installment-1',
        titleId: 'payable-1',
        amount: 80,
        party: { id: 'supplier-1', name: 'Fornecedor teste' },
      }),
    );
    expect(prisma.payableInstallment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          payable: expect.objectContaining({
            companyId: 'company-1',
            supplierId: 'supplier-1',
            OR: expect.any(Array),
          }),
          status: { not: 'CANCELED' },
        }),
      }),
    );
  });

  it('conta nfes autorizadas usando tenant autenticado e permissao fiscal', async () => {
    const { service, prisma, hasPermission } = makeService();
    prisma.nfe.groupBy.mockResolvedValue([{ status: 'AUTHORIZED', _count: 4 }]);

    const result = await service.query(
      {
        entity: 'nfes',
        metric: 'count',
        filters: {
          companyId: 'evil-company',
          status: 'AUTHORIZED',
          startDate: '2026-06-01',
          endDate: '2026-06-30',
          dateField: 'dataEmissao',
        },
      },
      user,
    );

    expect(result).toEqual(
      expect.objectContaining({
        entity: 'nfes',
        metric: 'count',
        total: 4,
      }),
    );
    expect(hasPermission).toHaveBeenCalledWith(
      user,
      'view',
      'nota_fiscal:emitidas',
    );
    expect(prisma.nfe.groupBy).toHaveBeenCalledWith({
      by: ['status'],
      where: {
        companyId: 'company-1',
        status: 'AUTHORIZED',
        dataEmissao: {
          gte: new Date('2026-06-01T00:00:00.000-03:00'),
          lte: new Date('2026-06-30T23:59:59.999-03:00'),
        },
      },
      _count: true,
    });
  });

  it('busca nfces sem selecionar xml, chave, protocolo ou links', async () => {
    const { service, prisma } = makeService();
    prisma.nfce.findMany.mockResolvedValue([
      {
        id: 'nfce-1',
        numero: 15,
        serie: 1,
        status: 'REJECTED',
        ambiente: 2,
        createdAt: new Date('2026-06-01T12:00:00.000Z'),
        dataEmissao: new Date('2026-06-01T12:00:00.000Z'),
        dataAutorizacao: null,
        dataCancelamento: null,
        motivoRejeicao: 'Dados fiscais invalidos',
        motivoCancelamento: null,
        orderId: null,
        quotationId: null,
        contingencia: false,
      },
    ]);

    const result = await service.search(
      {
        entity: 'nfces',
        filters: { search: '15', companyId: 'evil-company' },
      },
      user,
    );

    expect(result.records).toEqual([
      expect.objectContaining({
        id: 'nfce-1',
        numero: 15,
        status: 'REJECTED',
        ambiente: 'homologacao',
      }),
    ]);
    const select = prisma.nfce.findMany.mock.calls[0][0].select;
    expect(select).not.toHaveProperty('xmlAutorizado');
    expect(select).not.toHaveProperty('chaveAcesso');
    expect(select).not.toHaveProperty('protocolo');
    expect(select).not.toHaveProperty('danfeUrl');
    expect(select).not.toHaveProperty('qrCodeUrl');
  });

  it('nega consulta fiscal quando faltar permissao para visualizar emitidas', async () => {
    const { service, prisma } = makeService(jest.fn().mockResolvedValue(false));

    await expect(
      service.query({ entity: 'nfses', metric: 'count' }, user),
    ).rejects.toBeInstanceOf(AiOperationalQueryDeniedError);
    expect(prisma.nfse.groupBy).not.toHaveBeenCalled();
  });
});
