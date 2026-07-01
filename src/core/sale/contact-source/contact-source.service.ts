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
    const hidden = await this.prisma.companyHiddenContactSource.findMany({
      where: { companyId },
      select: { contactSourceId: true },
    });
    const hiddenIds = hidden.map((h) => h.contactSourceId);

    return this.prisma.contactSource.findMany({
      where: {
        AND: [
          { OR: [{ companyId }, { companyId: null }] },
          { id: { notIn: hiddenIds } },
        ],
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

  async hide(id: string, companyId: string) {
    const source = await this.prisma.contactSource.findUnique({
      where: { id },
    });
    if (!source) throw new NotFoundException('Origem não encontrada.');
    return this.prisma.companyHiddenContactSource.upsert({
      where: { companyId_contactSourceId: { companyId, contactSourceId: id } },
      create: { companyId, contactSourceId: id },
      update: {},
    });
  }

  async unhide(id: string, companyId: string) {
    await this.prisma.companyHiddenContactSource.deleteMany({
      where: { companyId, contactSourceId: id },
    });
  }
}
