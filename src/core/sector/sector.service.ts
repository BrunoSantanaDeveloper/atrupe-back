import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateSectorDto } from './dto/create-sector.dto';
import { UpdateSectorDto } from './dto/update-sector.dto';
import { PrismaService } from 'nestjs-prisma';
import { SectorFilterDto } from './dto/filter.dto';

@Injectable()
export class SectorService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createSectorDto: CreateSectorDto) {
    const company = await this.prisma.company.findUnique({
      where: { id: createSectorDto.companyId },
    });

    if (!company) {
      throw new NotFoundException('Company not found');
    }

    return this.prisma.sector.create({
      data: {
        ...createSectorDto,
      },
    });
  }

  async findAll(filter: SectorFilterDto) {
    try {
      let where = {};
      if (filter.toService) {
        where = { ...where, toService: filter.toService };
      }

      if (filter.companyId) {
        where = { ...where, companyId: filter.companyId };
      }

      if (filter.kind) {
        where = { ...where, kind: filter.kind };
      }

      const sectors = await this.prisma.sector.findMany({
        where: where,
        take: +filter.limit,
        skip: (+filter.page - 1) * +filter.limit,
      });

      return {
        data: sectors,
        total: await this.prisma.sector.count({ where }),
      };
    } catch (e) {
      console.error(e);
      throw e;
    }
  }

  findOne(id: string) {
    return this.prisma.sector.findFirst({ where: { id: id } });
  }

  update(id: string, updateSectorDto: UpdateSectorDto) {
    return this.prisma.sector.update({
      where: { id: id },
      data: updateSectorDto,
    });
  }

  remove(id: string) {
    return this.prisma.sector.update({
      where: { id: id },
      data: { isActive: false },
    });
  }
}
