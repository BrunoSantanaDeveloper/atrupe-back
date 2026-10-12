import { NotFoundException } from '@nestjs/common';
import { AddressService } from './address.service';

describe('AddressService: endereço da empresa da sessão', () => {
  let prisma: any;
  let service: AddressService;

  const ownerOf = (companyId: string | null) =>
    jest.fn().mockResolvedValue(companyId ? { companyId } : null);

  beforeEach(() => {
    prisma = {
      address: {
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn().mockResolvedValue(2),
      },
      client: { findUnique: ownerOf('c-1'), count: jest.fn() },
      supplier: { findUnique: ownerOf('c-1') },
      employee: { findUnique: ownerOf('c-1') },
      contact: { findUnique: jest.fn() },
    };
    service = new AddressService(prisma, {} as any, {} as any);
  });

  it('alterar o endereço do cliente da empresa passa', async () => {
    prisma.address.findUnique.mockResolvedValue({
      id: 'ad-1',
      ownerType: 'CLIENT',
      ownerId: 'cli-1',
    });

    await service.update('ad-1', { street: 'Rua A' } as any, 'c-1');
    expect(prisma.client.findUnique).toHaveBeenCalledWith({
      where: { id: 'cli-1' },
      select: { companyId: true },
    });
    expect(prisma.address.update).toHaveBeenCalled();
  });

  it('o endereço do cliente de outra empresa responde 404', async () => {
    prisma.address.findUnique.mockResolvedValue({
      id: 'ad-9',
      ownerType: 'CLIENT',
      ownerId: 'cli-9',
    });
    prisma.client.findUnique = ownerOf('outra');

    await expect(
      service.update('ad-9', { street: 'x' } as any, 'c-1'),
    ).rejects.toThrow(new NotFoundException('Endereço não encontrado.'));
    await expect(service.delete('ad-9', 'c-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.address.update).not.toHaveBeenCalled();
    expect(prisma.address.delete).not.toHaveBeenCalled();
  });

  it.each([
    ['da própria empresa', { ownerType: 'COMPANY', companyId: 'outra' }, null],
    [
      'do colaborador',
      { ownerType: 'EMPLOYEE', employeeId: 'emp-9' },
      'employee',
    ],
    [
      'do fornecedor (supplierId)',
      { ownerType: 'SUPPLIER', supplierId: 'forn-9' },
      'supplier',
    ],
    [
      'do fornecedor (ownerId)',
      { ownerType: 'SUPPLIER', ownerId: 'forn-9' },
      'supplier',
    ],
  ])(
    'o endereço %s de outra empresa responde 404',
    async (_label, address, owner) => {
      prisma.address.findUnique.mockResolvedValue({ id: 'ad-9', ...address });
      if (owner) prisma[owner].findUnique = ownerOf('outra');

      await expect(
        service.update('ad-9', { street: 'x' } as any, 'c-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    },
  );

  it('o endereço de contato vai pela empresa do cliente do contato', async () => {
    prisma.address.findUnique.mockResolvedValue({
      id: 'ad-1',
      ownerType: 'CONTACT',
      ownerId: 'ct-1',
    });
    prisma.contact.findUnique.mockResolvedValue({
      client: { companyId: 'c-1' },
      supplier: null,
    });

    await service.update('ad-1', { street: 'Rua B' } as any, 'c-1');
    expect(prisma.address.update).toHaveBeenCalled();
  });

  it('o cliente da rota precisa ser da empresa', async () => {
    prisma.client.count.mockResolvedValue(0);

    await expect(service.assertClientOfCompany('cli-9', 'c-1')).rejects.toThrow(
      new NotFoundException('Cliente não encontrado.'),
    );
  });
});
