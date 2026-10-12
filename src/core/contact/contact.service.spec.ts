import { NotFoundException } from '@nestjs/common';
import { ContactService } from './contact.service';

const allFound = () =>
  jest.fn(async ({ where }: any) => where?.id?.in?.length ?? 0);

describe('ContactService: contatos da empresa da sessão', () => {
  let prisma: any;
  let service: ContactService;
  const ofCompany = {
    OR: [{ client: { companyId: 'c-1' } }, { supplier: { companyId: 'c-1' } }],
  };

  beforeEach(() => {
    prisma = {
      contact: {
        create: jest.fn(),
        createMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn(),
        delete: jest.fn(),
      },
      client: { count: allFound() },
      supplier: { count: allFound() },
    };
    service = new ContactService(prisma);
  });

  it('a lista só traz contatos de cliente ou fornecedor da empresa', async () => {
    await service.findAll(
      { page: '1', limit: '10', search: 'ana' } as any,
      'c-1',
    );

    const where = prisma.contact.findMany.mock.calls[0][0].where;
    expect(where.AND[0]).toEqual(ofCompany);
    expect(where.AND[1].OR[0]).toEqual({
      name: { contains: 'ana', mode: 'insensitive' },
    });
  });

  it('ler, alterar e apagar o contato de outra empresa responde 404', async () => {
    prisma.contact.findFirst.mockResolvedValue(null);

    await expect(service.findOne('ct-9', 'c-1')).rejects.toThrow(
      new NotFoundException('Contato não encontrado.'),
    );
    await expect(
      service.update('ct-9', { name: 'x' } as any, 'c-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove('ct-9', 'c-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.contact.findFirst).toHaveBeenCalledWith({
      where: { id: 'ct-9', ...ofCompany },
    });
    expect(prisma.contact.update).not.toHaveBeenCalled();
    expect(prisma.contact.delete).not.toHaveBeenCalled();
  });

  it('criar contato no cliente de outra empresa é recusado', async () => {
    prisma.client.count.mockResolvedValueOnce(0);

    await expect(
      service.create({ name: 'Ana', clientId: 'cli-9' } as any, 'c-1'),
    ).rejects.toThrow(new NotFoundException('Cliente não encontrado.'));
    expect(prisma.contact.create).not.toHaveBeenCalled();
  });

  it('em lote, só os campos do contato seguem para o banco', async () => {
    await service.bulk(
      [
        {
          name: 'Ana',
          clientId: 'cli-1',
          companyId: 'outra',
          id: 'forjado',
        } as any,
      ],
      'c-1',
    );

    expect(prisma.contact.createMany).toHaveBeenCalledWith({
      data: [
        {
          name: 'Ana',
          email: undefined,
          phone: undefined,
          mobile: undefined,
          observations: undefined,
          clientId: 'cli-1',
          supplierId: undefined,
        },
      ],
    });
  });

  it('mudar o contato para fornecedor de outra empresa é recusado', async () => {
    prisma.contact.findFirst.mockResolvedValue({ id: 'ct-1' });
    prisma.supplier.count.mockResolvedValueOnce(0);

    await expect(
      service.update('ct-1', { supplierId: 'forn-9' } as any, 'c-1'),
    ).rejects.toThrow(new NotFoundException('Fornecedor não encontrado.'));
    expect(prisma.contact.update).not.toHaveBeenCalled();
  });
});
