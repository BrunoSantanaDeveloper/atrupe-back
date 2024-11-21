import { Injectable } from '@nestjs/common';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { PrismaService } from 'nestjs-prisma';
import { ContactFilterDTO } from './dto/filter.dto';

@Injectable()
export class ContactService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createContactDto: CreateContactDto) {
    try {
      return await this.prisma.contact.create({
        data: createContactDto,
      });
    } catch (error) {
      console.error('Error creating contact:', error);
      throw error;
    }
  }

  async bulk(createContactDto: CreateContactDto[]) {
    try {
      return await this.prisma.contact.createMany({
        data: createContactDto,
      });
    } catch (error) {
      console.error('Error creating contact:', error);
      throw error;
    }
  }

  async findAll(filter: ContactFilterDTO) {
    try {
      const where = {};
      if (filter.search) {
        where['OR'] = [
          { name: { contains: filter.search, mode: 'insensitive' } },
          { email: { contains: filter.search, mode: 'insensitive' } },
        ];
      }

      if (filter.clientId) {
        where['clientId'] = filter.clientId;
      }

      if (filter.supplierId) {
        where['supplierId'] = filter.supplierId;
      }

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

  findOne(id: string) {
    return this.prisma.contact.findUnique({
      where: { id },
    });
  }

  update(id: string, updateContactDto: UpdateContactDto) {
    return this.prisma.contact.update({
      where: { id },
      data: updateContactDto,
    });
  }

  remove(id: string) {
    return this.prisma.contact.delete({
      where: { id },
    });
  }
}
