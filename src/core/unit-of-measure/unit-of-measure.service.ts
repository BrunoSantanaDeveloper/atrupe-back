import { Injectable } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { CreateUnitOfMeasureDto } from './dto/create-unit-of-measure.dto';
import { UpdateUnitOfMeasureDto } from './dto/update-unit-of-measure.dto';
import { UpdateDefaultVariantDto } from './dto/update-default-variant.dto';

@Injectable()
export class UnitOfMeasureService {
  constructor(private readonly prisma: PrismaService) {}

  create(createUnitOfMeasureDto: CreateUnitOfMeasureDto) {
    return this.prisma.companyUnitOfMeasure.create({
      data: {
        name: createUnitOfMeasureDto.name,
        code: createUnitOfMeasureDto.code,
        companyId: createUnitOfMeasureDto.companyId,
        description: createUnitOfMeasureDto.description,
        kind: createUnitOfMeasureDto.kind as any,
        variant: createUnitOfMeasureDto.variant as any,
        defaultVariant: createUnitOfMeasureDto.defaultVariant as any,
      },
    });
  }

  findAll(companyId: string) {
    return this.prisma.companyUnitOfMeasure.findMany({
      where: { companyId },
      orderBy: {
        name: 'asc',
      },
    });
  }

  findOne(id: string) {
    return this.prisma.companyUnitOfMeasure.findUnique({
      where: { id },
    });
  }

  update(id: string, updateUnitOfMeasureDto: UpdateUnitOfMeasureDto) {
    return this.prisma.companyUnitOfMeasure.update({
      where: { id },
      data: {
        name: updateUnitOfMeasureDto.name,
        code: updateUnitOfMeasureDto.code,
        description: updateUnitOfMeasureDto.description,
        kind: updateUnitOfMeasureDto.kind as any,
        variant: updateUnitOfMeasureDto.variant as any,
        defaultVariant: updateUnitOfMeasureDto.defaultVariant as any,
      },
    });
  }

  async updateDefaultVariant(
    companyId: string,
    kind: string,
    updateDefaultVariantDto: UpdateDefaultVariantDto,
  ) {
    // Funcionalidade implementada após a migração
    return this.prisma.companyUnitOfMeasure.updateMany({
      where: {
        companyId,
        kind: kind as any,
      },
      data: {
        defaultVariant: updateDefaultVariantDto.defaultVariant as any,
      },
    });
  }

  findByKind(companyId: string, kind: string) {
    // Funcionalidade implementada após a migração
    return this.prisma.companyUnitOfMeasure.findMany({
      where: {
        companyId,
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
        { code: 'MM', name: 'Milímetros', isDefault: true },
        { code: 'CM', name: 'Centímetros', isDefault: false },
        { code: 'MT', name: 'Metros', isDefault: false },
      ],
      WEIGHT: [
        { code: 'MG', name: 'Miligramas', isDefault: true },
        { code: 'GR', name: 'Gramas', isDefault: false },
        { code: 'KG', name: 'Quilogramas', isDefault: false },
      ],
      CAPACITY: [
        { code: 'ML', name: 'Mililitros', isDefault: true },
        { code: 'LT', name: 'Litros', isDefault: false },
      ],
    };

    return variants[kind] || [];
  }

  remove(id: string) {
    return this.prisma.companyUnitOfMeasure.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
