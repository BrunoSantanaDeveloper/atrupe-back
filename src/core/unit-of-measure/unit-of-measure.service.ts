import { Injectable } from '@nestjs/common';
import { SheetFormat } from '@prisma/client';
import { PrismaService } from 'nestjs-prisma';
import { SHEET_FORMAT_LABELS, sheetSizeOf } from '../material/paper';
import { CreateUnitOfMeasureDto } from './dto/create-unit-of-measure.dto';
import { UpdateUnitOfMeasureDto } from './dto/update-unit-of-measure.dto';
import { UpdateDefaultVariantDto } from './dto/update-default-variant.dto';

/** O padrão de exibição de cada tipo, quando a empresa não escolheu. */
export const UNIT_DEFAULTS = {
  LENGTH: 'MT', // Metros (padrão de exibição)
  WEIGHT: 'KG', // Quilogramas (padrão de exibição)
  CAPACITY: 'LT', // Litros (padrão de exibição)
  DISTANCE: 'KM', // Quilômetros (padrão de exibição)
  DURATION: 'HH', // Horas (padrão de exibição)
  UNITY: 'UN', // Unidades (padrão de exibição)
  AREA: 'M2', // Metros quadrados (padrão de exibição)
  SHEET: 'A4', // Folha A4 (Papéis no LITE, 13/10/2026)
};

/**
 * As variantes da folha (Papéis no LITE, 13/10/2026): o código é o do
 * formato do papel (SheetFormat) e a medida vai em mm; a personalizada não
 * tem medida.
 */
export const SHEET_VARIANTS = (
  ['A4', 'A3', 'SRA3', 'A3_PLUS', 'CUSTOM'] as SheetFormat[]
).map((code) => {
  const size = sheetSizeOf(code);
  return {
    code,
    name: size
      ? `${SHEET_FORMAT_LABELS[code]} (${size.width} × ${size.height} mm)`
      : SHEET_FORMAT_LABELS[code],
    width: size?.width ?? null,
    height: size?.height ?? null,
  };
});

@Injectable()
export class UnitOfMeasureService {
  constructor(private readonly prisma: PrismaService) {}

  create(createUnitOfMeasureDto: CreateUnitOfMeasureDto) {
    return this.prisma.defaultUnitOfMeasure.create({
      data: {
        name: createUnitOfMeasureDto.name,
        code: createUnitOfMeasureDto.code,
        description: createUnitOfMeasureDto.description,
        kind: createUnitOfMeasureDto.kind as any,
      },
    });
  }

  findAll() {
    return this.prisma.defaultUnitOfMeasure.findMany({
      where: { isActive: true },
      orderBy: {
        name: 'asc',
      },
    });
  }

  findOne(id: string) {
    return this.prisma.defaultUnitOfMeasure.findUnique({
      where: { id },
    });
  }

  update(id: string, updateUnitOfMeasureDto: UpdateUnitOfMeasureDto) {
    return this.prisma.defaultUnitOfMeasure.update({
      where: { id },
      data: {
        name: updateUnitOfMeasureDto.name,
        code: updateUnitOfMeasureDto.code,
        description: updateUnitOfMeasureDto.description,
        kind: updateUnitOfMeasureDto.kind as any,
      },
    });
  }

  async updateDefaultVariant(
    companyId: string,
    kind: string,
    updateDefaultVariantDto: UpdateDefaultVariantDto,
  ) {
    // Buscar a empresa atual
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { unitDefaults: true },
    });

    // Preparar os padrões atuais
    const currentDefaults = (company?.unitDefaults as any) || {};

    // Atualizar o tipo específico
    const updatedDefaults = {
      ...currentDefaults,
      [kind]: updateDefaultVariantDto.defaultVariant,
    };

    // Se o tipo for LENGTH, atualizar automaticamente AREA com o equivalente quadrado
    if (kind === 'LENGTH') {
      const lengthToAreaMapping = {
        MM: 'MM2',
        CM: 'CM2',
        MT: 'M2',
      };

      const areaVariant =
        lengthToAreaMapping[updateDefaultVariantDto.defaultVariant];
      if (areaVariant) {
        updatedDefaults['AREA'] = areaVariant;
      }
    }

    // Salvar na empresa
    return this.prisma.company.update({
      where: { id: companyId },
      data: {
        unitDefaults: updatedDefaults,
      },
    });
  }

  async getCompanyUnitDefaults(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { unitDefaults: true },
    });

    // O tipo que a empresa ainda não escolheu (a folha, que chegou depois
    // dos padrões gravados) vale o padrão de exibição
    return {
      ...UNIT_DEFAULTS,
      ...((company?.unitDefaults as Record<string, string>) ?? {}),
    };
  }

  async getCompanyDefaultUnits(companyId: string) {
    const unitDefaults = await this.getCompanyUnitDefaults(companyId);

    // Buscar as unidades padrão da empresa
    const defaultUnits = await this.prisma.defaultUnitOfMeasure.findMany({
      where: {
        code: {
          in: Object.values(unitDefaults),
        },
        isActive: true,
      },
      orderBy: {
        kind: 'asc',
      },
    });

    // Filtrar apenas uma unidade por kind, priorizando por variant se existir
    const uniqueUnits = new Map();

    for (const unit of defaultUnits) {
      const kindValue = unitDefaults[unit.kind as string];

      if (kindValue && unit.code === kindValue) {
        if (!uniqueUnits.has(unit.kind)) {
          uniqueUnits.set(unit.kind, unit);
        }
      }
    }

    return Array.from(uniqueUnits.values());
  }

  findByKind(kind: string) {
    return this.prisma.defaultUnitOfMeasure.findMany({
      where: {
        kind: kind as any,
        isActive: true,
      },
      orderBy: {
        name: 'asc',
      },
    });
  }

  getVariantsByKind(kind: string) {
    const variants = {
      LENGTH: [
        { code: 'MM', name: 'Milímetro (mm)' },
        { code: 'CM', name: 'Centímetro (cm)' },
        { code: 'MT', name: 'Metro (m)' },
      ],
      WEIGHT: [
        { code: 'MG', name: 'Miligrama (mg)' },
        { code: 'GR', name: 'Grama (g)' },
        { code: 'KG', name: 'Quilograma (kg)' },
      ],
      CAPACITY: [
        { code: 'ML', name: 'Mililitro (ml)' },
        { code: 'LT', name: 'Litro (l)' },
      ],
      DISTANCE: [{ code: 'KM', name: 'Quilômetro (km)' }],
      DURATION: [{ code: 'HH', name: 'Hora (h)' }],
      UNITY: [{ code: 'UN', name: 'Unidade (un)' }],
      AREA: [
        { code: 'MM2', name: 'Milímetro Quadrado (mm²)' },
        { code: 'CM2', name: 'Centímetro Quadrado (cm²)' },
        { code: 'M2', name: 'Metro Quadrado (m²)' },
      ],
      // A folha leva a medida em mm (largura × altura)
      SHEET: SHEET_VARIANTS,
    };

    return variants[kind] || [];
  }

  async getVariantsByKindWithDefaults(kind: string, companyId: string) {
    const variants = this.getVariantsByKind(kind);
    const companyDefaults = await this.getCompanyUnitDefaults(companyId);
    const defaultVariant = companyDefaults[kind];

    return variants.map((variant) => ({
      ...variant,
      isDefault: variant.code === defaultVariant,
    }));
  }

  remove(id: string) {
    return this.prisma.defaultUnitOfMeasure.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
