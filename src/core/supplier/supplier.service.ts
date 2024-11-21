import { Injectable } from '@nestjs/common';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { PrismaService } from 'nestjs-prisma';
import { SupplierFilterDTO } from './dto/filter.dto';
import { OwnerType, Prisma, Supplier } from '@prisma/client';

@Injectable()
export class SupplierService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createDto: CreateSupplierDto) {
    try {
      const details =
        createDto.kind === 'PERSON'
          ? {
              cpf: createDto.cpf,
              rg: createDto.rg,
            }
          : {
              cnpj: createDto.cnpj,
              stateRegistration: createDto.stateRegistration || '',
            };

      const created = await this.prisma.supplier.create({
        data: {
          name: createDto.name,
          kind: createDto.kind,
          email: createDto.email,
          birthdate: createDto.birthdate,
          phoneNumber: createDto.phoneNumber,
          mobilePhone: createDto.mobilePhone,
          companyId: createDto.companyId,
          categoryId: createDto.categoryId,
          details: details,
        },
      });

      if (created && createDto.street) {
        try {
          const address = await this.prisma.address.create({
            data: this.buildAddressObject(createDto, created),
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
      console.error('Error creating supplier:', error);
      throw error;
    }
  }

  async findAll(filter: SupplierFilterDTO) {
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

      const suppliers = await this.prisma.supplier.findMany({
        where: where,
        take: +filter.limit,
        skip: (+filter.page - 1) * +filter.limit,
      });

      return {
        data: suppliers,
        total: await this.prisma.supplier.count({ where }),
      };
    } catch (e) {
      console.error(e);
      throw e;
    }
  }

  findOne(id: string) {
    return this.prisma.supplier.findUnique({
      where: { id: id },
      include: { contacts: true, address: true },
    });
  }

  async update(id: string, updateDto: UpdateSupplierDto) {
    try {
      const supplier = await this.findOne(id);
      if (!supplier) {
        throw new Error('Supplier not found');
      }

      const update = this.buildUpdateObject(updateDto);
      const details = this.buildDetailsObject(updateDto, supplier);
      const address = this.buildAddressObject(updateDto, supplier);

      if (supplier.addressId) {
        update['address'] = { update: address };
      } else {
        update['address'] = { create: address };
      }

      if (Object.keys(details).length) {
        update['details'] = details;
      }

      if (!Object.keys(update).length) {
        return supplier;
      }

      return await this.prisma.supplier.update({
        where: { id },
        data: update,
        include: { contacts: true, address: true },
      });
    } catch (error) {
      console.error('Error updating supplier:', error);
      throw error;
    }
  }

  private buildUpdateObject(dto: UpdateSupplierDto): any {
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
      'kind',
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

  private buildDetailsObject(
    dto: UpdateSupplierDto,
    supplier: Supplier,
  ): Prisma.JsonValue {
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

    if (
      supplier?.details &&
      typeof supplier?.details === 'object' &&
      !Array.isArray(supplier?.details)
    ) {
      return { ...supplier?.details, ...updatedDetails };
    } else {
      return updatedDetails;
    }
  }

  private buildAddressObject(
    dto: UpdateSupplierDto | CreateSupplierDto,
    client: any,
  ): any {
    const address = { ownerId: client.id, ownerType: OwnerType.SUPPLIER };
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
    return this.prisma.supplier.delete({
      where: { id: id },
    });
  }
}
