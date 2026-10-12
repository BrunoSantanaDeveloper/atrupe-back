import { SalarySheetsService } from './salary-sheets.service';

describe('SalarySheetsService: empresa da sessão', () => {
  let prisma: any;
  let service: SalarySheetsService;

  beforeEach(() => {
    prisma = {
      employee: { findMany: jest.fn().mockResolvedValue([]) },
      payroll: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    service = new SalarySheetsService(prisma, {} as any, {} as any);
  });

  it('gerar a folha só considera colaboradores da empresa: o de outra é "não encontrado"', async () => {
    const result = await service.generateSalarySheetForEmployees(
      { month: 1, year: 2026, list: ['colab-de-outra'] },
      'c-1',
    );

    expect(prisma.employee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['colab-de-outra'] }, companyId: 'c-1' },
      }),
    );
    expect(result.success).toBe(0);
    expect(result.errors).toEqual([
      expect.objectContaining({ employeeId: 'colab-de-outra' }),
    ]);
  });

  it('abrir ou fechar a folha de outra empresa conta como não encontrada', async () => {
    await expect(
      service.toggleSalarySheetStatus(
        { payrollId: 'folha-de-outra', status: 'CLOSED' } as any,
        'c-1',
      ),
    ).rejects.toThrow();
    expect(prisma.payroll.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'folha-de-outra', companyId: 'c-1' },
      }),
    );
  });
});
