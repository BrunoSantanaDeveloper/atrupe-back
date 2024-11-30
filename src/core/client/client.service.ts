import { Injectable } from '@nestjs/common';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { PrismaService } from 'nestjs-prisma';
import { ClientFilterDTO } from './dto/filter.dto';
import { OwnerType, Prisma } from '@prisma/client';

@Injectable()
export class ClientService {
  constructor(private readonly prisma: PrismaService) {}
  async create(createClientDto: CreateClientDto) {
    console.log(createClientDto);
    try {
      const created = await this.prisma.client.create({
        data: {
          name: createClientDto.name,
          type: createClientDto.type,
          email: createClientDto.email,
          birthdate:
            (createClientDto.birthdate &&
              new Date(createClientDto.birthdate)) ||
            null,
          phone: createClientDto.phone,
          mobile: createClientDto.mobile,
          companyId: createClientDto.companyId,
          categoryId: createClientDto.categoryId,
          cpf: createClientDto.cpf,
          rg: createClientDto.rg,
          cnpj: createClientDto.cnpj,
          activity: createClientDto.activity,
          tradeName: createClientDto.tradeName,
          corporateName: createClientDto.corporateName,
        },
      });

      if (created && createClientDto.street) {
        try {
          const address = await this.prisma.address.create({
            data: this.buildAddressObject(createClientDto, created),
          });

          if (!address) {
            throw new Error('Error creating address');
          }

          return await this.prisma.client.update({
            where: { id: created.id },
            data: { address: { connect: address } },
          });
        } catch (error) {
          console.error('Error creating address:', error);
        }
      }

      return created;
    } catch (error) {
      console.error('Error creating client:', error);
      throw error;
    }
  }

  async findAll(filter: ClientFilterDTO) {
    try {
      let where = {};
      if (filter.companyId) {
        where = { ...where, companyId: filter.companyId };
      }

      if (filter.search) {
        where = {
          ...where,
          OR: [
            { name: { contains: filter.search, mode: 'insensitive' } },
            { email: { contains: filter.search, mode: 'insensitive' } },
          ],
        };
      }

      if (filter.categoryId) {
        where = { ...where, categoryId: filter.categoryId };
      }

      if (filter.status) {
        where = { ...where, status: filter.status };
      }

      const [total, clients] = await Promise.all([
        this.prisma.client.count({ where }),
        this.prisma.client.findMany({
          where: where,
          take: +filter.limit,
          skip: (+filter.page - 1) * +filter.limit,
        }),
      ]);

      const lastPage = Math.ceil(total / +filter.limit);

      return {
        total,
        lastPage,
        data: clients,
      };
    } catch (e) {
      console.error(e);
      throw e;
    }
  }

  async findOne(id: string) {
    return this.prisma.client.findUnique({
      where: { id: id },
      include: { contacts: true, address: true },
    });
  }

  async update(id: string, updateClientDto: UpdateClientDto) {
    try {
      const client = await this.findOne(id);
      if (!client) {
        throw new Error('Client not found');
      }

      const update = this.buildUpdateObject(updateClientDto);
      const address = this.buildAddressObject(updateClientDto, client);

      if (client.addressId) {
        update['address'] = { update: address };
      } else {
        update['address'] = { create: address };
      }

      if (!Object.keys(update).length) {
        return client;
      }

      return await this.prisma.client.update({
        where: { id },
        data: update,
        include: { contacts: true, address: true },
      });
    } catch (error) {
      console.error('Error updating client:', error);
      throw error;
    }
  }

  private buildUpdateObject(dto: UpdateClientDto): any {
    const fieldsToUpdate = [
      'name',
      'email',
      'phoneNumber',
      'mobilePhone',
      'nickname',
      'site',
      'facebook',
      'status',
      'birthdate',
      'notes',
      'financialNotes',
      'responsibleId',
      'activityId',
      'type',
    ];
    const update = fieldsToUpdate.reduce((acc, field) => {
      if (dto[field]) {
        acc[field] = dto[field];
      }
      return acc;
    }, {});

    if (dto.responsibleId) {
      update['responsible'] = { connect: { id: dto.responsibleId } };
    }

    if (dto.categoryId) {
      update['category'] = { connect: { id: dto.categoryId } };
    }
    if (dto.companyId) {
      update['company'] = { connect: { id: dto.companyId } };
    }

    return update;
  }

  private buildDetailsObject(dto: UpdateClientDto): Prisma.JsonValue {
    const fieldsToUpdate = ['ie', 'cnpj', 'stateRegistration', 'cpf', 'rg'];

    const updatedDetails = fieldsToUpdate.reduce(
      (acc, field) => {
        if (dto[field] !== undefined) {
          acc[field] = dto[field];
        }
        return acc;
      },
      {} as Record<string, any>,
    );

    return updatedDetails;
  }

  private buildAddressObject(
    dto: UpdateClientDto | CreateClientDto,
    client: any,
  ): any {
    const address = { ownerId: client.id, ownerType: OwnerType.CLIENT };
    const addressFields = [
      'cityId',
      'stateId',
      'zipcode',
      'street',
      'number',
      'complement',
      'neighborhood',
    ];
    addressFields.forEach((field) => {
      if (dto[field]) {
        if (field === 'cityId' || field === 'stateId') {
          const relation = field === 'cityId' ? 'city' : 'state';
          address[relation] = { connect: { id: dto[field] } };
        } else {
          address[field] = dto[field];
        }
      }
    });

    return address;
  }

  remove(id: string) {
    return this.prisma.client.delete({
      where: { id: id },
    });
  }
}
