import { Injectable } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { CreateUnitOfMeasureDto } from './dto/create-unit-of-measure.dto';
import { UpdateUnitOfMeasureDto } from './dto/update-unit-of-measure.dto';
import { UpdateDefaultVariantDto } from './dto/update-default-variant.dto';

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
        variant: createUnitOfMeasureDto.variant as any,
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
        variant: updateUnitOfMeasureDto.variant as any,
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

    // Atualizar apenas o tipo específico
    const updatedDefaults = {
      ...currentDefaults,
      [kind]: updateDefaultVariantDto.defaultVariant,
    };

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

    return (
      (company?.unitDefaults as any) || {
        LENGTH: 'MT', // Metros (padrão de exibição)
        WEIGHT: 'KG', // Quilogramas (padrão de exibição)
        CAPACITY: 'LT', // Litros (padrão de exibição)
        DISTANCE: 'KM', // Quilômetros (padrão de exibição)
        DURATION: 'HH', // Horas (padrão de exibição)
        UNITY: 'UN', // Unidades (padrão de exibição)
        AREA: 'M2', // Metros quadrados (padrão de exibição)
      }
    );
  }

  async getCompanyDefaultUnits(companyId: string) {
    const unitDefaults = await this.getCompanyUnitDefaults(companyId);

    // Buscar as unidades padrão da empresa
    const defaultUnits = await this.prisma.defaultUnitOfMeasure.findMany({
      where: {
        OR: [
          {
            variant: {
              in: Object.values(unitDefaults),
            },
          },
          {
            code: {
              in: Object.values(unitDefaults),
            },
          },
        ],
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

      if (
        kindValue &&
        (unit.variant === kindValue || unit.code === kindValue)
      ) {
        if (!uniqueUnits.has(unit.kind) || unit.variant === kindValue) {
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
        { code: 'MG', name: 'Miligrama (ml)' },
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
      AREA: [{ code: 'M2', name: 'Metro Quadrado (m²)' }],
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
