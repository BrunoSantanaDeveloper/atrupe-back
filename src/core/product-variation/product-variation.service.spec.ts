import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProductVariationService } from './product-variation.service';

const P = '7d7f2f8e-4c1b-4d7e-9a43-0f5b1a9c2e10';
const V1 = '0a3c4f4e-1a2b-4c5d-8e9f-001122334455';
const V2 = '1b4d5e6f-2b3c-4d5e-9f00-112233445566';

const variation = (
  id: string,
  name: string,
  unitPrice: number | null,
  tiers = 0,
) => ({
  id,
  name,
  unitPrice,
  _count: { priceTiers: tiers },
});

describe('ProductVariationService', () => {
  let prisma: any;
  let service: ProductVariationService;

  beforeEach(() => {
    prisma = {
      product: {
        findFirst: jest.fn().mockResolvedValue({ id: P, _count: { items: 1 } }),
      },
      productVariation: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({ id: V1 }),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn(async ({ where, data }) =>
          variation(where.id, data.name ?? 'M', data.unitPrice ?? null),
        ),
        delete: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      productPriceTier: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    prisma.$transaction = jest.fn(async (run: any) => run(prisma));
    service = new ProductVariationService(prisma);
  });

  describe('produto da empresa', () => {
    it('produto de outra empresa responde 404 em toda rota', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      for (const call of [
        () => service.list('c-1', P),
        () => service.replace('c-1', P, [], true),
        () => service.update('c-1', P, V1, { name: 'G' }, true),
        () => service.remove('c-1', P, V1),
        () => service.tiers('c-1', P),
        () => service.saveTiers('c-1', P, { tiers: [] }),
      ]) {
        await expect(call()).rejects.toThrow('Produto não encontrado');
      }
      expect(prisma.product.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: P, companyId: 'c-1' } }),
      );
      expect(prisma.productVariation.deleteMany).not.toHaveBeenCalled();
      expect(prisma.productPriceTier.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('lista', () => {
    it('em ordem, com a tabela própria marcada', async () => {
      prisma.productVariation.findMany.mockResolvedValue([
        variation(V1, 'P', 4900, 2),
        variation(V2, 'M', null),
      ]);

      expect(await service.list('c-1', P)).toEqual({
        data: [
          {
            id: V1,
            name: 'P',
            unitPrice: 4900,
            hasOwnAssembly: false,
            hasOwnTiers: true,
          },
          {
            id: V2,
            name: 'M',
            unitPrice: null,
            hasOwnAssembly: false,
            hasOwnTiers: false,
          },
        ],
      });
      expect(prisma.productVariation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { productId: P },
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        }),
      );
    });
  });

  describe('substituir a lista', () => {
    beforeEach(() => {
      prisma.productVariation.findMany.mockResolvedValueOnce([
        { id: V1, unitPrice: 4900 },
        { id: V2, unitPrice: 5200 },
      ]);
    });

    it('mantém as que vêm com id, cria as novas e tira as que ficaram de fora', async () => {
      await service.replace(
        'c-1',
        P,
        [
          { id: V2, name: ' GG ', unitPrice: 5600 },
          { name: 'XG', unitPrice: null },
        ],
        true,
      );

      expect(prisma.productVariation.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: [V1] }, productId: P },
      });
      expect(prisma.productVariation.update).toHaveBeenCalledWith({
        where: { id: V2 },
        data: { name: 'GG', unitPrice: 5600, position: 0 },
      });
      expect(prisma.productVariation.create).toHaveBeenCalledWith({
        data: { productId: P, name: 'XG', unitPrice: null, position: 1 },
      });
    });

    it('sem a permissão de valores, o preço que estava fica', async () => {
      await service.replace(
        'c-1',
        P,
        [
          { id: V1, name: 'P', unitPrice: null },
          { name: 'G', unitPrice: 9999 },
        ],
        false,
      );

      expect(
        prisma.productVariation.update.mock.calls[0][0].data.unitPrice,
      ).toBe(4900);
      expect(
        prisma.productVariation.create.mock.calls[0][0].data.unitPrice,
      ).toBeNull();
    });

    it.each([
      [[{ name: '  ' }], 'Dê um nome para cada variação'],
      [
        [{ name: 'Médio' }, { name: 'MEDIO' }],
        'Duas variações com o mesmo nome',
      ],
    ])('recusa nomes inválidos (%#)', async (rows, message) => {
      await expect(
        service.replace('c-1', P, rows as any, true),
      ).rejects.toThrow(message);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('variação que não é do produto responde 404', async () => {
      await expect(
        service.replace(
          'c-1',
          P,
          [{ id: '9e9e9e9e-9e9e-4e9e-8e9e-9e9e9e9e9e9e', name: 'P' }],
          true,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('kit não tem variação', async () => {
      prisma.product.findFirst.mockResolvedValue({
        id: P,
        _count: { items: 2 },
      });

      await expect(
        service.replace('c-1', P, [{ name: 'P' }], true),
      ).rejects.toThrow(/kit não tem variação/);
    });

    it('lista vazia num kit apaga as que houver', async () => {
      prisma.product.findFirst.mockResolvedValue({
        id: P,
        _count: { items: 2 },
      });

      await service.replace('c-1', P, [], true);

      expect(prisma.productVariation.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: [V1, V2] }, productId: P },
      });
    });
  });

  describe('editar uma variação', () => {
    it('recusa o nome de outra variação, sem caixa e sem acento', async () => {
      prisma.productVariation.findMany.mockResolvedValue([{ name: 'Médio' }]);

      await expect(
        service.update('c-1', P, V1, { name: 'MEDIO' }, true),
      ).rejects.toThrow('Já existe uma variação com esse nome');
    });

    it('nome vazio é recusado', async () => {
      await expect(
        service.update('c-1', P, V1, { name: ' ' }, true),
      ).rejects.toThrow('Dê um nome à variação');
    });

    it('o preço só muda com a permissão de valores; nulo volta ao do produto', async () => {
      await service.update('c-1', P, V1, { unitPrice: 5600 }, false);
      await service.update('c-1', P, V1, { unitPrice: null }, true);

      expect(prisma.productVariation.update.mock.calls[0][0].data).toEqual({});
      expect(prisma.productVariation.update.mock.calls[1][0].data).toEqual({
        unitPrice: null,
      });
    });

    it('variação de outro produto responde 404', async () => {
      prisma.productVariation.findFirst.mockResolvedValue(null);

      await expect(
        service.update('c-1', P, V2, { name: 'G' }, true),
      ).rejects.toThrow('Variação não encontrada');
      await expect(service.remove('c-1', P, V2)).rejects.toThrow(
        'Variação não encontrada',
      );
      expect(prisma.productVariation.findFirst).toHaveBeenCalledWith({
        where: { id: V2, productId: P },
        select: { id: true },
      });
      expect(prisma.productVariation.delete).not.toHaveBeenCalled();
    });
  });

  describe('faixas de preço', () => {
    it('a do produto', async () => {
      prisma.productPriceTier.findMany.mockResolvedValue([
        { from: 1, unitPrice: 35 },
        { from: 101, unitPrice: 28 },
      ]);

      expect(await service.tiers('c-1', P)).toEqual({
        inherited: false,
        tiers: [
          { from: 1, unitPrice: 35 },
          { from: 101, unitPrice: 28 },
        ],
      });
      expect(prisma.productPriceTier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { productId: P, variationId: null } }),
      );
    });

    it('a variação sem tabela própria herda a do produto', async () => {
      prisma.productPriceTier.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ from: 1, unitPrice: 35 }]);

      expect(await service.tiers('c-1', P, V1)).toEqual({
        inherited: true,
        tiers: [{ from: 1, unitPrice: 35 }],
      });
    });

    it('grava a tabela inteira, em ordem', async () => {
      await service.saveTiers('c-1', P, {
        tiers: [
          { from: 101, unitPrice: 28 },
          { from: 1, unitPrice: 35 },
        ],
      });

      expect(prisma.productPriceTier.deleteMany).toHaveBeenCalledWith({
        where: { productId: P, variationId: null },
      });
      expect(prisma.productPriceTier.createMany).toHaveBeenCalledWith({
        data: [
          { from: 1, unitPrice: 35, productId: P, variationId: null },
          { from: 101, unitPrice: 28, productId: P, variationId: null },
        ],
      });
    });

    it('duas faixas na mesma quantidade são recusadas', async () => {
      await expect(
        service.saveTiers('c-1', P, {
          tiers: [
            { from: 10, unitPrice: 30 },
            { from: 10, unitPrice: 25 },
          ],
        }),
      ).rejects.toThrow('Duas faixas começam na mesma quantidade');
      expect(prisma.productPriceTier.deleteMany).not.toHaveBeenCalled();
    });

    it('herdar apaga a tabela da variação', async () => {
      await service.saveTiers('c-1', P, {
        variationId: V1,
        inherit: true,
        tiers: [{ from: 1, unitPrice: 10 }],
      });

      expect(prisma.productPriceTier.deleteMany).toHaveBeenCalledWith({
        where: { productId: P, variationId: V1 },
      });
      expect(prisma.productPriceTier.createMany).not.toHaveBeenCalled();
    });

    it('herdar sem variação é recusado', async () => {
      await expect(
        service.saveTiers('c-1', P, { inherit: true, tiers: [] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('variação de outro produto responde 404', async () => {
      prisma.productVariation.findFirst.mockResolvedValue(null);

      await expect(service.tiers('c-1', P, V2)).rejects.toThrow(
        'Variação não encontrada',
      );
      await expect(
        service.saveTiers('c-1', P, { variationId: V2, tiers: [] }),
      ).rejects.toThrow('Variação não encontrada');
    });
  });
});
