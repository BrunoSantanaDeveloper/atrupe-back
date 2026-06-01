import { AiToolRegistry } from './ai-tool-registry.service';

describe('AiToolRegistry', () => {
  const companyId = 'company-1';
  const user = {
    userId: 'user-1',
    companyId,
    role: 'role-1',
    isAdmin: false,
    isSystemAdmin: false,
  };

  function makeRegistry(overrides?: {
    hasPermission?: jest.Mock;
    reportService?: Record<string, jest.Mock>;
  }) {
    const prisma = {
      academySystem: { findMany: jest.fn() },
      company: { findUnique: jest.fn() },
    };
    const abacService = {
      hasPermission:
        overrides?.hasPermission || jest.fn().mockResolvedValue(true),
    };
    const reportService = {
      menu: jest.fn(),
      getFinancialSummary: jest.fn(),
      getFinancialTable: jest.fn(),
      getCashFlowSummary: jest.fn(),
      getSalesReportSummary: jest.fn(),
      getTopClients: jest.fn(),
      getTopProducts: jest.fn(),
      getCommissionSummary: jest.fn(),
      ...(overrides?.reportService || {}),
    };
    const safety = {
      sanitizeToolArguments: jest.fn((args, allowedKeys) => {
        const clean = {};
        const removedKeys = [];
        Object.entries(args || {}).forEach(([key, value]) => {
          if (allowedKeys.includes(key)) clean[key] = value;
          else removedKeys.push(key);
        });
        return { clean, removedKeys };
      }),
      sanitizeText: jest.fn((value) => value),
    };

    return {
      registry: new AiToolRegistry(
        prisma as any,
        abacService as any,
        reportService as any,
        safety as any,
      ),
      reportService,
    };
  }

  it('nega consulta financeira sem permissão de valores', async () => {
    const hasPermission = jest
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const { registry, reportService } = makeRegistry({ hasPermission });

    const result = await registry.execute('get_financial_summary', {}, user);

    expect(result).toEqual({
      name: 'get_financial_summary',
      status: 'denied',
      content: {
        reason: 'Sem permissão para consultar dados financeiros e valores.',
      },
    });
    expect(reportService.getFinancialSummary).not.toHaveBeenCalled();
  });

  it('força sellerId do próprio colaborador quando não pode ver outros vendedores', async () => {
    const hasPermission = jest
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const getSalesReportSummary = jest
      .fn()
      .mockResolvedValue({ approvedTotal: 1 });
    const { registry } = makeRegistry({
      hasPermission,
      reportService: { getSalesReportSummary },
    });

    await registry.execute(
      'get_sales_summary',
      { sellerId: 'other-seller' },
      { ...user, employeeId: 'employee-1' },
    );

    expect(getSalesReportSummary).toHaveBeenCalledWith(companyId, {
      sellerId: 'employee-1',
    });
  });

  it('descarta companyId enviado em tool call e usa empresa do JWT', async () => {
    const getFinancialSummary = jest.fn().mockResolvedValue({ received: 10 });
    const { registry } = makeRegistry({
      reportService: { getFinancialSummary },
    });

    await registry.execute(
      'get_financial_summary',
      { companyId: 'evil-company', tab: 'receitas' },
      { ...user, isAdmin: true },
    );

    expect(getFinancialSummary).toHaveBeenCalledWith(companyId, {
      tab: 'receitas',
    });
  });
});
