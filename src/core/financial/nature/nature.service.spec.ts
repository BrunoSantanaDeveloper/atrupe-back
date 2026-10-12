import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { NatureService } from './nature.service';

describe('NatureService: isolamento por empresa', () => {
  let service: NatureService;
  let prisma: any;

  const nature = {
    id: 'n-1',
    companyId: 'c-1',
    level1: '02',
    level2: '01',
    code: '001',
  };

  beforeEach(async () => {
    prisma = {
      nature: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      subCategory: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn((fn) => fn(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [NatureService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(NatureService);
  });

  it('findOne procura pelo id e pela empresa da sessão', async () => {
    prisma.nature.findFirst.mockResolvedValue(nature);
    await expect(service.findOne('n-1', 'c-1')).resolves.toBe(nature);
    expect(prisma.nature.findFirst).toHaveBeenCalledWith({
      where: { id: 'n-1', companyId: 'c-1' },
    });
  });

  it('findOne responde 404 à natureza de outra empresa', async () => {
    prisma.nature.findFirst.mockResolvedValue(null);
    await expect(service.findOne('n-9', 'c-1')).rejects.toThrow(
      new NotFoundException('Natureza não encontrada!'),
    );
  });

  it('update não altera a natureza de outra empresa', async () => {
    prisma.nature.findFirst.mockResolvedValue(null);
    await expect(
      service.update('n-9', 'c-1', { description: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.nature.update).not.toHaveBeenCalled();
  });

  it('update altera a natureza da empresa', async () => {
    prisma.nature.findFirst.mockResolvedValue(nature);
    await service.update('n-1', 'c-1', { description: 'Aluguel' });
    expect(prisma.nature.update).toHaveBeenCalledWith({
      where: { id: 'n-1' },
      data: { description: 'Aluguel' },
    });
  });

  it('remove responde 404, e não 400, à natureza de outra empresa', async () => {
    prisma.nature.findFirst.mockResolvedValue(null);
    await expect(service.remove('n-9', 'c-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.subCategory.updateMany).not.toHaveBeenCalled();
    expect(prisma.nature.update).not.toHaveBeenCalled();
  });

  it('remove desativa a natureza da empresa e as subcategorias dela', async () => {
    prisma.nature.findFirst.mockResolvedValue(nature);
    await service.remove('n-1', 'c-1');
    expect(prisma.subCategory.updateMany).toHaveBeenCalledWith({
      where: { natureId: 'n-1' },
      data: { isActive: false },
    });
    expect(prisma.nature.update).toHaveBeenCalledWith({
      where: { id: 'n-1' },
      data: { isActive: false },
    });
  });

  it('createSubCategory recusa natureza de outra empresa', async () => {
    prisma.nature.findFirst.mockResolvedValue(null);
    await expect(
      service.createSubCategory({
        natureId: 'n-9',
        companyId: 'c-1',
        code: '01',
        description: 'x',
      } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.nature.findFirst).toHaveBeenCalledWith({
      where: { id: 'n-9', companyId: 'c-1' },
    });
    expect(prisma.subCategory.create).not.toHaveBeenCalled();
  });

  it('createSubCategory cria dentro da natureza da empresa', async () => {
    prisma.nature.findFirst.mockResolvedValue(nature);
    prisma.subCategory.findFirst.mockResolvedValue(null);
    const dto = {
      natureId: 'n-1',
      companyId: 'c-1',
      code: '01',
      description: 'Luz',
    } as any;
    await service.createSubCategory(dto);
    expect(prisma.subCategory.create).toHaveBeenCalledWith({ data: dto });
  });

  it('a lista de subcategorias só traz as de natureza da empresa', async () => {
    prisma.subCategory.findMany.mockResolvedValue([]);
    await service.findAllSubCategoryByNature('n-9', 'c-1');
    expect(prisma.subCategory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: true,
          natureId: 'n-9',
          nature: { companyId: 'c-1' },
        },
      }),
    );
  });

  it('updateSubCategory não altera subcategoria de outra empresa', async () => {
    prisma.nature.findFirst.mockResolvedValue(nature);
    prisma.subCategory.findFirst.mockResolvedValue(null);
    await expect(
      service.updateSubCategory('s-9', { description: 'x' }, 'c-1'),
    ).rejects.toThrow(new NotFoundException('Subcategoria nao encontrada'));
    expect(prisma.subCategory.findFirst).toHaveBeenCalledWith({
      where: { id: 's-9', nature: { companyId: 'c-1' } },
    });
    expect(prisma.subCategory.update).not.toHaveBeenCalled();
  });

  it('removeSubCategory não desativa subcategoria de outra empresa', async () => {
    prisma.subCategory.findFirst.mockResolvedValue(null);
    await expect(service.removeSubCategory('s-9', 'c-1')).rejects.toThrow(
      new NotFoundException('Subcategoria nao encontrada'),
    );
    expect(prisma.subCategory.findFirst).toHaveBeenCalledWith({
      where: { id: 's-9', nature: { companyId: 'c-1' } },
      select: { id: true },
    });
    expect(prisma.subCategory.update).not.toHaveBeenCalled();
  });

  it('removeSubCategory desativa a subcategoria da empresa', async () => {
    prisma.subCategory.findFirst.mockResolvedValue({ id: 's-1' });
    await service.removeSubCategory('s-1', 'c-1');
    expect(prisma.subCategory.update).toHaveBeenCalledWith({
      where: { id: 's-1' },
      data: { isActive: false },
    });
  });
});
