import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { SupplierService } from './supplier.service';

/**
 * Três defeitos que a Samys encontrou no cadastro de fornecedor:
 *
 * - a checagem de duplicidade comparava o documento com máscara, como a tela
 *   manda, contra o que o banco guarda sem pontuação: nunca batia, e o mesmo
 *   fornecedor entrava de novo;
 * - a gravação apagava os endereços pelo `ownerId`, que é do cliente, então
 *   cada salvamento deixava uma cópia do endereço;
 * - a contagem das abas somava os clientes da empresa, não os fornecedores.
 */
describe('SupplierService', () => {
  let service: SupplierService;
  let prisma: any;

  const COMPANY = 'company-1';

  const fornecedor = (over: Record<string, unknown> = {}) => ({
    id: 'forn-1',
    companyId: COMPANY,
    name: 'Vivo',
    cpf: null,
    cnpj: '02558157000162',
    status: 'ACTIVE',
    isBranch: false,
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      supplier: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(fornecedor()),
        update: jest.fn().mockResolvedValue(fornecedor()),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      client: { findFirst: jest.fn(), groupBy: jest.fn() },
      address: {
        create: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      contact: { create: jest.fn(), deleteMany: jest.fn() },
      supplierPaymentCondition: { create: jest.fn(), deleteMany: jest.fn() },
      $transaction: jest.fn((fn) => fn(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupplierService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<SupplierService>(SupplierService);
    // findOne devolve o fornecedor montado; aqui não é o que está sob teste.
    jest.spyOn(service, 'findOne').mockResolvedValue({} as any);
  });

  describe('duplicidade de documento', () => {
    /** O defeito: a tela manda "02.558.157/0001-62", o banco tem os dígitos. */
    it('reconhece o CNPJ com máscara contra o que está gravado', async () => {
      prisma.supplier.findFirst.mockResolvedValue(fornecedor());

      const dto: any = {
        type: 'COMPANY',
        companyId: COMPANY,
        general: { name: 'Vivo de novo', cnpj: '02.558.157/0001-62' },
      };

      await expect(service.create(dto)).rejects.toThrow(BadRequestException);

      const where = prisma.supplier.findFirst.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        { cnpj: '02558157000162' },
        { cnpj: '02.558.157/0001-62' },
      ]);
    });

    it('diz qual cadastro está com o documento', async () => {
      prisma.supplier.findFirst.mockResolvedValue(
        fornecedor({ name: 'Telefônica Brasil SA', status: 'INACTIVE' }),
      );

      const dto: any = {
        type: 'COMPANY',
        companyId: COMPANY,
        general: { name: 'Vivo', cnpj: '02.558.157/0001-62' },
      };

      await expect(service.create(dto)).rejects.toThrow(
        /Telefônica Brasil SA \(inativo\)/,
      );
    });

    it('não procura duplicata quando o cadastro é filial', async () => {
      const dto: any = {
        type: 'COMPANY',
        companyId: COMPANY,
        general: {
          name: 'Filial',
          cnpj: '02.558.157/0001-62',
          isBranch: true,
        },
      };

      await service.create(dto).catch(() => undefined);

      expect(prisma.supplier.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('apaga os endereços do fornecedor pelo supplierId', async () => {
      await service.update('forn-1', {
        addresses: [{ type: 'Principal', zipcode: '13389200' }],
      } as any);

      expect(prisma.address.deleteMany).toHaveBeenCalledWith({
        where: { supplierId: 'forn-1' },
      });
      // Um endereço entra, um sai: salvar de novo não acumula cópia.
      expect(prisma.address.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('findAllQuantity', () => {
    it('conta os fornecedores, não os clientes', async () => {
      prisma.supplier.groupBy.mockResolvedValue([
        { status: 'ACTIVE', _count: 41 },
        { status: 'INACTIVE', _count: 1 },
      ]);

      const totais = await service.findAllQuantity(COMPANY);

      expect(prisma.client.groupBy).not.toHaveBeenCalled();
      expect(totais).toEqual({
        PROSPECT: 0,
        ACTIVE: 41,
        INACTIVE: 1,
        TOTAL: 42,
      });
    });
  });
});
