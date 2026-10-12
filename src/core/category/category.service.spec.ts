import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { CategoryService } from './category.service';

async function rejection(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (e) => e,
  );
  expect(error).toBeDefined();
  return error;
}

describe('CategoryService: isolamento por empresa', () => {
  let service: CategoryService;
  let prisma: any;

  const own = {
    id: 'g-1',
    companyId: 'c-1',
    kind: 'CLIENT',
    isStandard: false,
  };
  const standard = {
    id: 'g-std',
    companyId: null,
    kind: 'PRODUCT',
    isStandard: true,
  };

  beforeEach(async () => {
    prisma = {
      category: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      companySector: { findFirst: jest.fn() },
      product: { count: jest.fn().mockResolvedValue(0) },
      scheduledExpense: { count: jest.fn().mockResolvedValue(0) },
      client: { count: jest.fn().mockResolvedValue(0) },
      supplier: { count: jest.fn().mockResolvedValue(0) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoryService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(CategoryService);
  });

  it('findOne lê as da empresa e as padrão do sistema, como as listas', async () => {
    prisma.category.findFirst.mockResolvedValue(standard);
    await expect(service.findOne('g-std', 'c-1')).resolves.toBe(standard);
    expect(prisma.category.findFirst).toHaveBeenCalledWith({
      where: { id: 'g-std', OR: [{ companyId: 'c-1' }, { isStandard: true }] },
    });
  });

  it('findOne responde 404 à categoria de outra empresa', async () => {
    prisma.category.findFirst.mockResolvedValue(null);
    await expect(service.findOne('g-9', 'c-1')).rejects.toThrow(
      new NotFoundException('Categoria não encontrada.'),
    );
  });

  it('a padrão do sistema não pode ser alterada nem excluída', async () => {
    prisma.category.findFirst.mockResolvedValue(standard);

    const onUpdate = await rejection(
      service.update('g-std', 'c-1', { name: 'Meu' }),
    );
    expect(onUpdate).toBeInstanceOf(UnprocessableEntityException);
    expect(onUpdate.getResponse().code).toBe('STANDARD_CATEGORY');

    const onRemove = await rejection(service.remove('g-std', 'c-1'));
    expect(onRemove.getResponse().code).toBe('STANDARD_CATEGORY');

    expect(prisma.category.update).not.toHaveBeenCalled();
    expect(prisma.category.delete).not.toHaveBeenCalled();
  });

  it('update e remove não mexem na categoria de outra empresa', async () => {
    prisma.category.findFirst.mockResolvedValue(null);
    await expect(
      service.update('g-9', 'c-1', { name: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove('g-9', 'c-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.category.update).not.toHaveBeenCalled();
    expect(prisma.category.delete).not.toHaveBeenCalled();
  });

  it('update altera a categoria da empresa', async () => {
    prisma.category.findFirst.mockResolvedValue(own);
    await service.update('g-1', 'c-1', { name: 'VIP' });
    expect(prisma.category.update).toHaveBeenCalledWith({
      data: { name: 'VIP' },
      where: { id: 'g-1' },
    });
  });

  it('remove exclui a categoria da empresa que não está em uso', async () => {
    prisma.category.findFirst.mockResolvedValue(own);
    await service.remove('g-1', 'c-1');
    expect(prisma.category.delete).toHaveBeenCalledWith({
      where: { id: 'g-1' },
    });
  });

  it('o setor do grupo precisa ser da empresa', async () => {
    prisma.companySector.findFirst.mockResolvedValue(null);
    await expect(
      service.create({
        name: 'Banners',
        kind: 'PRODUCT',
        sectorId: 's-9',
        companyId: 'c-1',
      } as any),
    ).rejects.toThrow(new NotFoundException('Setor não encontrado.'));
    expect(prisma.companySector.findFirst).toHaveBeenCalledWith({
      where: { id: 's-9', companyId: 'c-1' },
      select: { id: true },
    });
    expect(prisma.category.create).not.toHaveBeenCalled();

    prisma.category.findFirst.mockResolvedValue({
      ...own,
      kind: 'PRODUCT',
    });
    await expect(
      service.update('g-1', 'c-1', { sectorId: 's-9' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.category.update).not.toHaveBeenCalled();
  });

  it('sem setor (vazio), não consulta o setor', async () => {
    prisma.category.findFirst.mockResolvedValue(own);
    await service.update('g-1', 'c-1', { name: 'x', sectorId: '' });
    expect(prisma.companySector.findFirst).not.toHaveBeenCalled();
    expect(prisma.category.update).toHaveBeenCalled();
  });
});
