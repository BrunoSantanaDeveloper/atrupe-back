import { Injectable } from '@nestjs/common';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { Category } from '@prisma/client';
import { CategoryFilterDTO } from './dto/filter.dto';
import { PrismaService } from 'nestjs-prisma';

@Injectable()
export class CategoryService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createCategoryDto: CreateCategoryDto) {
    try {
      return await this.prisma.category.create({ data: createCategoryDto });
    } catch (error) {
      console.log(error);
      throw new Error('Error on create category');
    }
  }

  findAll(filter: CategoryFilterDTO): Promise<Category[]> {
    let where = {};

    if (filter.companyId) {
      where = {
        ...where,
        OR: [{ company: null }, { company: { id: filter.companyId } }],
      };
    } else {
      where = {
        ...where,
        isStandard: true,
      };
    }

    if (filter.kind) {
      where = { ...where, kind: filter.kind };
    }

    return this.prisma.category.findMany({
      where,
      include: { children: true },
      take: +filter.limit,
      skip: (+filter.page - 1) * +filter.limit,
    });
  }

  findOne(id: string) {
    return this.prisma.category.findUnique({ where: { id } });
  }

  update(id: string, updateCategoryDto: UpdateCategoryDto) {
    return this.prisma.category.update({
      data: updateCategoryDto,
      where: { id },
    });
  }

  remove(id: string) {
    return this.prisma.category.delete({ where: { id } });
  }
}
