import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { SalariesService } from './salaries.service';
import { PayrollStructureService } from './payroll-structure.service';
import { PlanControlService } from '../../plan/plan-control.service';
import { CostAuditService } from '../../cost-base/cost-audit.service';

// A linha como a estrutura da folha lê (item de antes, sem comportamento)
const row = (over: Record<string, unknown> = {}) => ({
  id: 'ps-1',
  name: 'Salário',
  amount: 100,
  type: 'INCREASE',
  isSet: true,
  behavior: null,
  increase: null,
  discount: null,
  manualOverride: false,
  templateId: 't-1',
  employeeId: 'e-1',
  payrollTemplate: null,
  employee: { contract: null },
  ...over,
});

describe('SalariesService: isolamento por empresa', () => {
  let service: SalariesService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      payrollSetup: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        delete: jest.fn(),
      },
      employee: { findFirst: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalariesService,
        PayrollStructureService,
        { provide: PrismaService, useValue: prisma },
        { provide: PlanControlService, useValue: { hasFeature: jest.fn() } },
        { provide: CostAuditService, useValue: { record: jest.fn() } },
      ],
    }).compile();

    service = module.get(SalariesService);
  });

  it('getSalaryDetails procura pelo id e pela empresa da sessão', async () => {
    prisma.payrollSetup.findFirst.mockResolvedValue({ id: 'ps-1' });
    await service.getSalaryDetails('ps-1', 'c-1');
    expect(prisma.payrollSetup.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ps-1', companyId: 'c-1' } }),
    );
  });

  it('getSalaryDetails responde 404 ao item de outra empresa', async () => {
    prisma.payrollSetup.findFirst.mockResolvedValue(null);
    await expect(service.getSalaryDetails('ps-9', 'c-1')).rejects.toThrow(
      new NotFoundException('Item da folha não encontrado.'),
    );
  });

  it('update não altera o item de outra empresa', async () => {
    prisma.payrollSetup.findFirst.mockResolvedValue(null);
    await expect(
      service.update('ps-9', 'c-1', { amount: 99999 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.payrollSetup.update).not.toHaveBeenCalled();
  });

  it('update não liga o item a colaborador de outra empresa', async () => {
    prisma.payrollSetup.findFirst.mockResolvedValue({ id: 'ps-1' });
    prisma.employee.findFirst.mockResolvedValue(null);
    await expect(
      service.update('ps-1', 'c-1', { employeeId: 'e-9' }),
    ).rejects.toThrow(new NotFoundException('Colaborador não encontrado.'));
    expect(prisma.employee.findFirst).toHaveBeenCalledWith({
      where: { id: 'e-9', companyId: 'c-1' },
      select: { id: true },
    });
    expect(prisma.payrollSetup.update).not.toHaveBeenCalled();
  });

  it('update altera o item da empresa, com o comportamento junto', async () => {
    prisma.payrollSetup.findFirst.mockResolvedValue(row());
    prisma.payrollSetup.update.mockResolvedValue(row({ amount: 150 }));
    await service.update('ps-1', 'c-1', { amount: 150 });
    expect(prisma.payrollSetup.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ps-1', companyId: 'c-1' },
      }),
    );
    expect(prisma.payrollSetup.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ps-1' },
        data: expect.objectContaining({
          amount: 150,
          type: 'INCREASE',
          behavior: 'ONLY_INCREASE',
          increase: 150,
          discount: 0,
        }),
      }),
    );
  });

  it('mover o item para outro colaborador leva o comportamento junto', async () => {
    prisma.payrollSetup.findFirst.mockResolvedValue({
      id: 'ps-1',
      type: 'INCREASE',
      amount: 100,
    });
    prisma.employee.findFirst.mockResolvedValue({ id: 'e-2' });
    await service.update('ps-1', 'c-1', {
      employeeId: 'e-2',
      type: 'DISCOUNT',
    });
    expect(prisma.payrollSetup.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'DISCOUNT',
          behavior: 'ONLY_DISCOUNT',
          increase: 0,
          discount: 100,
        }),
      }),
    );
  });

  it('delete não apaga o item de outra empresa', async () => {
    prisma.payrollSetup.findFirst.mockResolvedValue(null);
    await expect(service.delete('ps-9', 'c-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.payrollSetup.delete).not.toHaveBeenCalled();
  });

  it('delete apaga o item da empresa', async () => {
    prisma.payrollSetup.findFirst.mockResolvedValue({ id: 'ps-1' });
    await service.delete('ps-1', 'c-1');
    expect(prisma.payrollSetup.delete).toHaveBeenCalledWith({
      where: { id: 'ps-1' },
    });
  });
});
