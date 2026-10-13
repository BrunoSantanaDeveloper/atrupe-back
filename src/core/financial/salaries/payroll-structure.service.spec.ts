import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PayrollStructureService } from './payroll-structure.service';

// A linha como a estrutura lê, com o item e o contrato do colaborador
const row = (over: Record<string, unknown> = {}) => ({
  id: 'ps-1',
  name: 'Salário',
  amount: 300000,
  type: 'INCREASE',
  isSet: true,
  behavior: 'ONLY_INCREASE',
  increase: 300000,
  discount: 0,
  manualOverride: false,
  templateId: 't-1',
  employeeId: 'e-1',
  createdAt: new Date(),
  updatedAt: new Date(),
  payrollTemplate: {
    derivedFromSalary: false,
    fixedByLaw: false,
    isBase: true,
    systemKey: 'BASE_SALARY',
  },
  employee: { contract: 'CLT' },
  ...over,
});

describe('PayrollStructureService: a linha do colaborador', () => {
  let prisma: any;
  let audit: any;
  let service: PayrollStructureService;

  beforeEach(() => {
    prisma = {
      payrollSetup: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(async ({ data }) => row(data)),
      },
      employee: {
        update: jest.fn(),
        // Sem salário base: o syncEmployee para cedo
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    audit = { record: jest.fn() };
    service = new PayrollStructureService(
      prisma,
      { hasFeature: jest.fn().mockResolvedValue(false) } as any,
      audit,
    );
  });

  it('procura a linha pela empresa da sessão', async () => {
    prisma.payrollSetup.findFirst.mockResolvedValue(null);
    await expect(
      service.updateLine('c-2', null, 'ps-1', { increase: 1 }),
    ).rejects.toThrow(new NotFoundException('Item não encontrado'));
    expect(prisma.payrollSetup.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ps-1', companyId: 'c-2' } }),
    );
  });

  it('o salário base pela folha vira o salário do colaborador', async () => {
    prisma.payrollSetup.findFirst.mockResolvedValue(row());
    const sync = jest.spyOn(service, 'syncEmployee');
    await service.updateLine('c-1', 'u-1', 'ps-1', { increase: 400000 });
    expect(prisma.employee.update).toHaveBeenCalledWith({
      where: { id: 'e-1' },
      data: { baseSalary: 400000, sallary: 400000 },
    });
    expect(sync).toHaveBeenCalledWith('c-1', 'e-1');
  });

  it('o salário base não vira desconto nem provisão', async () => {
    prisma.payrollSetup.findFirst.mockResolvedValue(row());
    await expect(
      service.updateLine('c-1', null, 'ps-1', { behavior: 'ONLY_DISCOUNT' }),
    ).rejects.toThrow(
      new BadRequestException('O salário base é sempre acréscimo'),
    );
    await expect(
      service.updateLine('c-1', null, 'ps-1', { type: 'DISCOUNT' }),
    ).rejects.toThrow(
      new BadRequestException('O salário base é sempre acréscimo'),
    );
    expect(prisma.payrollSetup.update).not.toHaveBeenCalled();
  });

  it('acrescentar o salário base de novo não mexe no cadastro', async () => {
    prisma.payrollSetup.findFirst.mockResolvedValue(row({ isSet: false }));
    await service.updateLine('c-1', null, 'ps-1', { isSet: true });
    expect(prisma.employee.update).not.toHaveBeenCalled();
  });

  it('a linha comum não mexe no cadastro do colaborador', async () => {
    prisma.payrollSetup.findFirst.mockResolvedValue(
      row({
        name: 'Vale-transporte',
        payrollTemplate: {
          derivedFromSalary: false,
          fixedByLaw: false,
          isBase: false,
          systemKey: null,
        },
      }),
    );
    await service.updateLine('c-1', null, 'ps-1', {
      behavior: 'INCREASE_AND_DISCOUNT',
      increase: 10000,
      discount: 25000,
    });
    expect(prisma.employee.update).not.toHaveBeenCalled();
    expect(prisma.payrollSetup.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          behavior: 'INCREASE_AND_DISCOUNT',
          increase: 10000,
          discount: 25000,
          type: 'DISCOUNT',
          amount: 15000,
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'PAYROLL_SETUP', action: 'UPDATE' }),
    );
  });

  it('o INSS volta a acompanhar o salário; o item comum não tem valor à mão', async () => {
    const inss = row({
      name: 'INSS',
      behavior: 'INCREASE_AND_DISCOUNT',
      manualOverride: true,
      payrollTemplate: {
        derivedFromSalary: true,
        fixedByLaw: false,
        isBase: false,
        systemKey: 'INSS',
      },
    });
    prisma.payrollSetup.findFirst.mockResolvedValue(inss);
    prisma.payrollSetup.findMany.mockResolvedValue([
      { ...inss, manualOverride: false },
    ]);
    const sync = jest.spyOn(service, 'syncEmployee');
    const line = await service.updateLine('c-1', null, 'ps-1', {
      manualOverride: false,
    });
    expect(prisma.payrollSetup.update).toHaveBeenCalledWith({
      where: { id: 'ps-1' },
      data: { manualOverride: false },
    });
    expect(sync).toHaveBeenCalledWith('c-1', 'e-1');
    expect(line.manualOverride).toBe(false);

    prisma.payrollSetup.findFirst.mockResolvedValue(row());
    await expect(
      service.updateLine('c-1', null, 'ps-1', { manualOverride: false }),
    ).rejects.toThrow(
      new BadRequestException('Só INSS e FGTS têm valor à mão'),
    );
  });

  it('13º e férias não se editam; o INSS à mão deixa de seguir o salário', async () => {
    prisma.payrollSetup.findFirst.mockResolvedValue(
      row({
        name: '13º salário + FGTS + INSS',
        behavior: 'PROVISION',
        payrollTemplate: {
          derivedFromSalary: true,
          fixedByLaw: true,
          isBase: false,
          systemKey: 'THIRTEENTH',
        },
      }),
    );
    await expect(
      service.updateLine('c-1', null, 'ps-1', { increase: 1 }),
    ).rejects.toThrow(
      new BadRequestException(
        'Férias e 13º são calculados por lei e não podem ser editados',
      ),
    );

    prisma.payrollSetup.findFirst.mockResolvedValue(
      row({
        name: 'INSS',
        behavior: 'INCREASE_AND_DISCOUNT',
        payrollTemplate: {
          derivedFromSalary: true,
          fixedByLaw: false,
          isBase: false,
          systemKey: 'INSS',
        },
      }),
    );
    await service.updateLine('c-1', null, 'ps-1', {
      increase: 50000,
      discount: 50000,
    });
    expect(prisma.payrollSetup.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ manualOverride: true }),
      }),
    );
  });
});
