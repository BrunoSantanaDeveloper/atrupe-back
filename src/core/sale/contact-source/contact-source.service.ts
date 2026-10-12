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

    if (source.companyId === null) {
      // Global item: hide it and create a company-owned copy with the new name
      await this.hide(id, companyId);
      return this.prisma.contactSource.create({
        data: { name: dto.name, companyId },
      });
    }

    if (source.companyId !== companyId)
      throw new ForbiddenException('Sem permissão para editar esta origem.');

    return this.prisma.contactSource.update({ where: { id }, data: dto });
  }

  async remove(id: string, companyId: string) {
    const source = await this.prisma.contactSource.findUnique({
      where: { id },
    });
    if (!source) throw new NotFoundException('Origem não encontrada.');

    if (source.companyId === null) {
      // Global item: hide it for this company instead of deleting
      return this.hide(id, companyId);
    }

    if (source.companyId !== companyId)
      throw new ForbiddenException('Sem permissão para excluir esta origem.');

    return this.prisma.contactSource.delete({ where: { id } });
  }

  async hide(id: string, companyId: string) {
    const source = await this.prisma.contactSource.findUnique({
      where: { id },
    });
    // Só a origem global ou a da própria empresa: ocultar a origem privada
    // de outra empresa gravava um vínculo que impedia a dona de excluí-la
    if (!source || (source.companyId && source.companyId !== companyId)) {
      throw new NotFoundException('Origem não encontrada.');
    }
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
