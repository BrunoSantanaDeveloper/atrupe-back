import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PricingCenterService } from './pricing-center.service';
import { marginAfterChargesOf, markupOf, profitFits } from './pricing-math';

// Os parâmetros do contrato: 6 % + 3 % + 1,5 % de encargos e 30 % de lucro
const PARAMS = {
  taxation: 60,
  commission: 30,
  financialCost: 15,
  desiredMargin: 300,
};

describe('precificação: as contas', () => {
  it('markup pelo método divisor (contrato: 1,68)', () => {
    expect(markupOf(PARAMS)).toBe(1.68);
    expect(markupOf({ ...PARAMS, desiredMargin: 895 })).toBeNull();
  });

  it('a margem desconta os encargos (PR-2)', () => {
    // Mão de obra do contrato: hora a 60,00 com custo de 16,49
    expect(marginAfterChargesOf(6000, 1649, PARAMS)).toBe(62);
    expect(marginAfterChargesOf(null, 1649, PARAMS)).toBeNull();
  });

  it('o lucro cabe no preço só abaixo de 100 % com os encargos', () => {
    expect(profitFits(PARAMS, 894)).toBe(true);
    expect(profitFits(PARAMS, 895)).toBe(false);
  });
});

describe('PricingCenterService: gravar o preço', () => {
  let prisma: any;
  let audit: any;
  let service: PricingCenterService;

  // Um setor produtivo com custo-hora e outro sem horas
  const snapshot = {
    referenceMonth: '2026-09',
    today: new Date('2026-10-13T12:00:00Z'),
    sectorById: new Map([
      [
        'impressao',
        { hourSale: null, hourSaleRule: 'FIXED', hourSaleProfit: null },
      ],
      [
        'producao',
        { hourSale: 6000, hourSaleRule: 'FIXED', hourSaleProfit: null },
      ],
    ]),
    labor: [
      { id: 'impressao', name: 'Impressão', costPerHour: 1250 },
      { id: 'producao', name: 'Produção', costPerHour: null },
    ],
    allocations: [],
    assets: [],
  };

  beforeEach(() => {
    prisma = {
      companySector: { update: jest.fn() },
      assetSetup: { update: jest.fn() },
      assetGroup: {
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    audit = { record: jest.fn() };
    service = new PricingCenterService(
      prisma,
      { parametersOf: jest.fn().mockResolvedValue(PARAMS) } as any,
      { load: jest.fn().mockResolvedValue(snapshot) } as any,
      {} as any,
      audit,
    );
  });

  const refuses = (promise: Promise<unknown>, message: string) =>
    expect(promise).rejects.toThrow(new BadRequestException(message));

  it('material e produto têm o preço no cadastro deles', async () => {
    await refuses(
      service.updateItem('c', null, 'mat:x', {
        group: 'materials',
        rule: 'FIXED',
        price: 1,
      }),
      'O preço do material é gravado no cadastro do material',
    );
    await refuses(
      service.updateItem('c', null, 'p', {
        group: 'products',
        rule: 'FIXED',
        price: 1,
      }),
      'O preço do produto é definido no cadastro do produto',
    );
  });

  it('item de fora responde 404; sem custo, recusa', async () => {
    await expect(
      service.updateItem('c', null, 'outro', {
        group: 'labor',
        rule: 'FIXED',
        price: 1,
      }),
    ).rejects.toThrow(new NotFoundException('Item não encontrado'));
    await refuses(
      service.updateItem('c', null, 'producao', {
        group: 'labor',
        rule: 'FIXED',
        price: 7000,
      }),
      'Este item ainda não tem custo calculado.',
    );
  });

  it('fixo exige preço; variável calcula pelo lucro e confere o enviado', async () => {
    await refuses(
      service.updateItem('c', null, 'impressao', {
        group: 'labor',
        rule: 'FIXED',
      }),
      'Informe o preço',
    );
    await refuses(
      service.updateItem('c', null, 'impressao', {
        group: 'labor',
        rule: 'VARIABLE',
        profit: 900,
      }),
      'O lucro e os encargos passam de 100% do preço',
    );
    // 12,50 ÷ (1 − 0,105 − 0,30) = 21,01
    await refuses(
      service.updateItem('c', null, 'impressao', {
        group: 'labor',
        rule: 'VARIABLE',
        profit: 300,
        price: 2000,
      }),
      'O preço mudou; abra o item de novo',
    );
    await service.updateItem('c', 'u', 'impressao', {
      group: 'labor',
      rule: 'VARIABLE',
      profit: 300,
      price: 2101,
    });
    expect(prisma.companySector.update).toHaveBeenCalledWith({
      where: { id: 'impressao' },
      data: { hourSale: 2101, hourSaleRule: 'VARIABLE', hourSaleProfit: 300 },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'PRICING_ITEM',
        entityId: 'impressao',
      }),
    );
  });

  it('a soma dos parâmetros fica abaixo de 100 %', async () => {
    await refuses(
      service.updateParameters('c', null, { ...PARAMS, desiredMargin: 895 }),
      'A soma dos parâmetros precisa ficar abaixo de 100%',
    );
  });
});
