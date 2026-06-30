import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { CreateContactSourceDto } from './dto/create-contact-source.dto';
import { UpdateContactSourceDto } from './dto/update-contact-source.dto';

@Injectable()
export class ContactSourceService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(companyId: string) {
    return this.prisma.contactSource.findMany({
      where: {
        OR: [{ companyId }, { companyId: null }],
      },
      orderBy: { name: 'asc' },
    });
  }

  async create(dto: CreateContactSourceDto) {
    return this.prisma.contactSource.create({ data: dto });
  }

  async update(id: string, companyId: string, dto: UpdateContactSourceDto) {
    const source = await this.prisma.contactSource.findUnique({
      where: { id },
    });
    if (!source) throw new NotFoundException('Origem não encontrada.');
    if (source.companyId !== companyId)
      throw new ForbiddenException('Não é possível editar uma origem global.');
    return this.prisma.contactSource.update({ where: { id }, data: dto });
  }

  async remove(id: string, companyId: string) {
    const source = await this.prisma.contactSource.findUnique({
      where: { id },
    });
    if (!source) throw new NotFoundException('Origem não encontrada.');
    if (source.companyId !== companyId)
      throw new ForbiddenException('Não é possível excluir uma origem global.');
    return this.prisma.contactSource.delete({ where: { id } });
  }
}
