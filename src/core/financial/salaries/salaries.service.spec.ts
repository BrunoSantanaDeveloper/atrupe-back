import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { SalariesService } from './salaries.service';

describe('SalariesService: isolamento por empresa', () => {
  let service: SalariesService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      payrollSetup: {
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      employee: { findFirst: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalariesService,
        { provide: PrismaService, useValue: prisma },
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

  it('update altera o item da empresa', async () => {
    prisma.payrollSetup.findFirst.mockResolvedValue({ id: 'ps-1' });
    await service.update('ps-1', 'c-1', { amount: 150 });
    expect(prisma.payrollSetup.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ps-1' },
        data: expect.objectContaining({ amount: 150 }),
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
