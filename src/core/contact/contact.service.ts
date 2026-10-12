import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { PrismaService } from 'nestjs-prisma';
import { ContactFilterDTO } from './dto/filter.dto';
import { assertBelongsToCompany } from 'src/shared/tenant/company-scope';

const CONTACT_NOT_FOUND = 'Contato não encontrado.';

/**
 * O contato não tem empresa: é do cliente ou do fornecedor. Sem este filtro,
 * a lista trazia os contatos de todas as empresas, e o id de outra empresa
 * lia, alterava ou apagava o contato dela.
 */
function contactOfCompany(companyId: string): Prisma.ContactWhereInput {
  return {
    OR: [{ client: { companyId } }, { supplier: { companyId } }],
  };
}

@Injectable()
export class ContactService {
  constructor(private readonly prisma: PrismaService) {}

  /** O cliente e o fornecedor do contato precisam ser da empresa */
  private async assertOwnersOfCompany(
    companyId: string,
    contacts: { clientId?: string | null; supplierId?: string | null }[],
  ) {
    await assertBelongsToCompany(
      this.prisma.client,
      contacts.map((contact) => contact.clientId),
      { companyId },
      'Cliente não encontrado.',
    );
    await assertBelongsToCompany(
      this.prisma.supplier,
      contacts.map((contact) => contact.supplierId),
      { companyId },
      'Fornecedor não encontrado.',
    );
  }

  async create(createContactDto: CreateContactDto, companyId: string) {
    await this.assertOwnersOfCompany(companyId, [createContactDto]);

    try {
      return await this.prisma.contact.create({
        data: createContactDto,
      });
    } catch (error) {
      console.error('Error creating contact:', error);
      throw error;
    }
  }

  async bulk(createContactDto: CreateContactDto[], companyId: string) {
    // O corpo em lista não passa pelo ValidationPipe: só os campos do contato
    // seguem para o banco
    const contacts = (Array.isArray(createContactDto) ? createContactDto : [])
      .filter((contact) => contact && typeof contact === 'object')
      .map((contact) => ({
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        mobile: contact.mobile,
        observations: contact.observations,
        clientId: contact.clientId,
        supplierId: contact.supplierId,
      }));
    await this.assertOwnersOfCompany(companyId, contacts);

    try {
      return await this.prisma.contact.createMany({
        data: contacts,
      });
    } catch (error) {
      console.error('Error creating contact:', error);
      throw error;
    }
  }

  async findAll(filter: ContactFilterDTO, companyId: string) {
    try {
      const conditions: Prisma.ContactWhereInput[] = [
        contactOfCompany(companyId),
      ];
      if (filter.search) {
        conditions.push({
          OR: [
            { name: { contains: filter.search, mode: 'insensitive' } },
            { email: { contains: filter.search, mode: 'insensitive' } },
          ],
        });
      }

      if (filter.clientId) {
        conditions.push({ clientId: filter.clientId });
      }

      if (filter.supplierId) {
        conditions.push({ supplierId: filter.supplierId });
      }

      const where: Prisma.ContactWhereInput = { AND: conditions };
      const contacts = await this.prisma.contact.findMany({
        where: where,
        take: +filter.limit,
        skip: (+filter.page - 1) * +filter.limit,
      });

      return {
        data: contacts,
        total: await this.prisma.contact.count({ where }),
      };
    } catch (error) {
      console.error('Error finding all contacts:', error);
      throw error;
    }
  }

  async findOne(id: string, companyId: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { id, ...contactOfCompany(companyId) },
    });
    if (!contact) {
      throw new NotFoundException(CONTACT_NOT_FOUND);
    }
    return contact;
  }

  async update(
    id: string,
    updateContactDto: UpdateContactDto,
    companyId: string,
  ) {
    await this.findOne(id, companyId);
    // Mudar o contato de dono só para cliente ou fornecedor da empresa
    await this.assertOwnersOfCompany(companyId, [updateContactDto]);

    return this.prisma.contact.update({
      where: { id },
      data: updateContactDto,
    });
  }

  async remove(id: string, companyId: string) {
    await this.findOne(id, companyId);

    return this.prisma.contact.delete({
      where: { id },
    });
  }
}
