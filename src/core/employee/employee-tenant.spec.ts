import { NotFoundException } from '@nestjs/common';
import { EmployeeService } from './employee.service';

/**
 * O cargo decide as permissões e o administrador do usuário: cargo (e
 * setor) de outra empresa no corpo é recusado antes de gravar.
 */
describe('EmployeeService: cargo e setor da empresa', () => {
  let prisma: any;
  let service: EmployeeService;

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn(),
      employee: {
        findUnique: jest.fn().mockResolvedValue({ companyId: 'c1' }),
      },
      role: { count: jest.fn() },
      companySector: { count: jest.fn() },
    };
    const history: any = { createEmployeeHistory: jest.fn() };
    service = new EmployeeService(
      prisma,
      history,
      {} as any,
      {
        syncEmployee: jest.fn(),
      } as any,
    );
  });

  it('criar com o cargo de outra empresa é recusado', async () => {
    prisma.role.count.mockResolvedValue(0);

    await expect(
      service.create({
        name: 'Ana',
        companyId: 'c1',
        roleId: 'cargo-de-outra',
        sectorId: 'setor-1',
      } as any),
    ).rejects.toThrow(new NotFoundException('Cargo não encontrado.'));
    expect(prisma.role.count).toHaveBeenCalledWith({
      where: { id: { in: ['cargo-de-outra'] }, companyId: 'c1' },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('criar com o setor de outra empresa é recusado', async () => {
    prisma.role.count.mockResolvedValue(1);
    prisma.companySector.count.mockResolvedValue(0);

    await expect(
      service.create({
        name: 'Ana',
        companyId: 'c1',
        roleId: 'cargo-1',
        sectorId: 'setor-de-outra',
      } as any),
    ).rejects.toThrow(new NotFoundException('Setor não encontrado.'));
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('trocar para o cargo de outra empresa é recusado, pela empresa do colaborador', async () => {
    prisma.role.count.mockResolvedValue(0);

    await expect(
      service.update('emp-1', { roleId: 'cargo-de-outra' } as any),
    ).rejects.toThrow(new NotFoundException('Cargo não encontrado.'));
    expect(prisma.employee.findUnique).toHaveBeenCalledWith({
      where: { id: 'emp-1' },
      select: { companyId: true },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('editar sem cargo nem setor não consulta nada a mais', async () => {
    prisma.$transaction.mockResolvedValue({ id: 'emp-1' });

    await service.update('emp-1', { name: 'Ana Souza' } as any);
    expect(prisma.employee.findUnique).not.toHaveBeenCalled();
    expect(prisma.role.count).not.toHaveBeenCalled();
  });

  it('o endereço do corpo grava só os campos de endereço, sem empresa nem dono de outra', async () => {
    const tx = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          userId: null,
          company: { ownerUserId: null },
        }),
        update: jest.fn().mockResolvedValue({ id: 'emp-1' }),
      },
      address: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(),
        create: jest.fn(),
      },
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));
    const endereco = {
      zipcode: '01310100',
      state: 'SP',
      city: 'São Paulo',
      neighborhood: 'Bela Vista',
      street: 'Avenida Paulista',
      number: '1000',
      complement: '',
    };

    await service
      .update('emp-1', {
        address: {
          ...endereco,
          id: 'endereco-x',
          companyId: 'empresa-b',
          ownerId: 'cliente-b',
          supplierId: 'fornecedor-b',
        },
      } as any)
      .catch(() => undefined);

    expect(tx.address.create).toHaveBeenCalledWith({
      data: { ...endereco, ownerType: 'EMPLOYEE', employeeId: 'emp-1' },
    });
  });
});
