import { UnitOfMeasureService } from './unit-of-measure.service';

/**
 * O padrão de medida ganha o tipo folha (Papéis no LITE, 13/10/2026): as
 * variantes A4, A3, SRA3, A3+ e personalizada, com a medida em mm, no mesmo
 * formato das outras (variants/:kind, by-kind/:kind, defaults).
 */
describe('UnitOfMeasureService', () => {
  let prisma: any;
  let service: UnitOfMeasureService;

  // Os padrões que as empresas já gravaram, antes da folha
  const SAVED = {
    LENGTH: 'MM',
    WEIGHT: 'KG',
    CAPACITY: 'LT',
    DISTANCE: 'KM',
    DURATION: 'HH',
    UNITY: 'UN',
    AREA: 'MM2',
  };

  beforeEach(() => {
    prisma = {
      company: {
        findUnique: jest.fn().mockResolvedValue({ unitDefaults: SAVED }),
        update: jest.fn(async ({ data }) => data),
      },
      defaultUnitOfMeasure: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    service = new UnitOfMeasureService(prisma);
  });

  it('as variantes da folha levam a medida em mm; a personalizada, não', () => {
    expect(service.getVariantsByKind('SHEET')).toEqual([
      { code: 'A4', name: 'A4 (210 × 297 mm)', width: 210, height: 297 },
      { code: 'A3', name: 'A3 (297 × 420 mm)', width: 297, height: 420 },
      { code: 'SRA3', name: 'SRA3 (320 × 450 mm)', width: 320, height: 450 },
      { code: 'A3_PLUS', name: 'A3+ (329 × 483 mm)', width: 329, height: 483 },
      { code: 'CUSTOM', name: 'Personalizado', width: null, height: null },
    ]);
    // As outras seguem como estavam
    expect(service.getVariantsByKind('LENGTH').map((v) => v.code)).toEqual([
      'MM',
      'CM',
      'MT',
    ]);
  });

  it('a empresa que gravou os padrões antes da folha fica com a A4', async () => {
    expect(await service.getCompanyUnitDefaults('c-1')).toEqual({
      ...SAVED,
      SHEET: 'A4',
    });

    const variants = await service.getVariantsByKindWithDefaults(
      'SHEET',
      'c-1',
    );
    expect(variants.filter((v) => v.isDefault).map((v) => v.code)).toEqual([
      'A4',
    ]);
  });

  it('a folha escolhida pela empresa vale, sem mexer nos outros tipos', async () => {
    await service.updateDefaultVariant('c-1', 'SHEET', {
      defaultVariant: 'SRA3',
    });
    expect(prisma.company.update).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: { unitDefaults: { ...SAVED, SHEET: 'SRA3' } },
    });

    prisma.company.findUnique.mockResolvedValue({
      unitDefaults: { ...SAVED, SHEET: 'SRA3' },
    });
    expect(await service.getCompanyUnitDefaults('c-1')).toMatchObject({
      SHEET: 'SRA3',
      AREA: 'MM2',
    });
  });

  it('as unidades padrão da empresa trazem a da folha', async () => {
    const a4 = { id: 'unit-sheet-a4', code: 'A4', kind: 'SHEET' };
    const mm = { id: 'unit-mm', code: 'MM', kind: 'LENGTH' };
    prisma.defaultUnitOfMeasure.findMany.mockResolvedValue([mm, a4]);

    expect(await service.getCompanyDefaultUnits('c-1')).toEqual([mm, a4]);
    expect(
      prisma.defaultUnitOfMeasure.findMany.mock.calls[0][0].where.code.in,
    ).toContain('A4');
  });

  it('by-kind da folha lê as unidades do tipo SHEET', async () => {
    await service.findByKind('SHEET');

    expect(prisma.defaultUnitOfMeasure.findMany).toHaveBeenCalledWith({
      where: { kind: 'SHEET', isActive: true },
      orderBy: { name: 'asc' },
    });
  });
});
