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
        { code: 'MM', name: 'Milímetros', isDefault: false },
        { code: 'CM', name: 'Centímetros', isDefault: false },
        { code: 'MT', name: 'Metros', isDefault: true },
      ],
      WEIGHT: [
        { code: 'MG', name: 'Miligramas', isDefault: false },
        { code: 'GR', name: 'Gramas', isDefault: false },
        { code: 'KG', name: 'Quilogramas', isDefault: true },
      ],
      CAPACITY: [
        { code: 'ML', name: 'Mililitros', isDefault: false },
        { code: 'LT', name: 'Litros', isDefault: true },
      ],
      DISTANCE: [{ code: 'KM', name: 'Quilômetros', isDefault: true }],
      DURATION: [{ code: 'HH', name: 'Horas', isDefault: true }],
      UNITY: [{ code: 'UN', name: 'Unidades', isDefault: true }],
      AREA: [{ code: 'M2', name: 'Metros Quadrados', isDefault: true }],
    };

    return variants[kind] || [];
  }

  remove(id: string) {
    return this.prisma.defaultUnitOfMeasure.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
