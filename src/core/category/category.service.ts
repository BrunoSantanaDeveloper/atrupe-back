import { Injectable } from '@nestjs/common';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
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

  async findAll(filter: CategoryFilterDTO): Promise<any> {
    const { page = 1, limit = 10 } = filter;
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
    const [total, data] = await Promise.all([
      this.prisma.category.count({
        where,
      }),
      this.prisma.category.findMany({
        where,
        include: { children: true },
        take: +limit,
        skip: (+page - 1) * +limit,
      }),
    ]);
    const lastPage = Math.ceil(total / +limit);

    return {
      total,
      lastPage,
      data,
    };
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
