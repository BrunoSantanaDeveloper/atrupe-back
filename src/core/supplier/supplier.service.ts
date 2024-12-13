import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { PrismaService } from 'nestjs-prisma';
import { SupplierFilterDTO } from './dto/filter.dto';
import { OwnerType, Prisma } from '@prisma/client';

@Injectable()
export class SupplierService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createDto: CreateSupplierDto) {
    try {
      // Criar o fornecedor
      const supplier = await this.prisma.supplier.create({
        data: {
          type: createDto.type,
          name: createDto.general.name,
          email: createDto.general.email,
          phone: createDto.general.phone,
          mobile: createDto.general.mobile,
          companyId: createDto.companyId,
          category: createDto.general.category,
          cpf: createDto.general.cpf,
          rg: createDto.general.rg,
          cnpj: createDto.general.cnpj,
          activity: createDto.general.activity,
          notes: createDto.general.notes,
          minValue: createDto.creditLimit.minValue,
          maxValue: createDto.creditLimit.maxValue,
          blockClient: createDto.creditLimit.blockClient,
        },
      });

      // Criar endereços
      if (createDto.addresses?.length > 0) {
        await Promise.all(
          createDto.addresses.map((address) =>
            this.prisma.address.create({
              data: {
                type: address.type,
                zipcode: address.zipcode,
                state: address.state,
                city: address.city,
                neighborhood: address.neighborhood,
                street: address.street,
                number: address.number,
                complement: address.complement,
                ownerId: supplier.id,
                ownerType: 'SUPPLIER',
              },
            }),
          ),
        );
      }

      // Criar contatos
      if (createDto.contacts?.length > 0) {
        await Promise.all(
          createDto.contacts.map((contact) =>
            this.prisma.contact.create({
              data: {
                name: contact.name,
                email: contact.email,
                phone: contact.phone,
                mobile: contact.mobile,
                notes: contact.notes,
                supplierId: supplier.id,
              },
            }),
          ),
        );
      }

      // Criar condições de pagamento do fornecedor
      if (createDto.creditLimit.conditions?.length > 0) {
        await Promise.all(
          createDto.creditLimit.conditions.map((condition) =>
            this.prisma.supplierPaymentCondition.create({
              data: {
                supplierId: supplier.id,
                paymentConditionId: condition.id,
                isActive: condition.isActive,
              },
            }),
          ),
        );
      }

      return this.findOne(supplier.id);
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
      const total = await this.prisma.supplier.count({ where });
      const suppliers = await this.prisma.supplier.findMany({
        where: where,
        take: +filter.limit,
        skip: (+filter.page - 1) * +filter.limit,
        orderBy: {
          name: 'asc',
        },
      });

      return {
        total,
        lastPage: Math.ceil(total / +filter.limit),
        data: suppliers,
      };
    } catch (e) {
      console.error(e);
      throw new BadRequestException('Supplier list error');
    }
  }

  async findOne(id: string) {
    return this.prisma.supplier.findUnique({
      where: { id },
      include: {
        contacts: true,
        address: true,
        paymentConditions: {
          include: {
            paymentCondition: true,
          },
        },
      },
    });
  }

  async update(id: string, updateDto: UpdateSupplierDto) {
    try {
      const supplier = await this.findOne(id);
      if (!supplier) {
        throw new Error('Supplier not found');
      }

      // Atualizar dados do fornecedor
      await this.prisma.supplier.update({
        where: { id },
        data: {
          name: updateDto.general?.name,
          email: updateDto.general?.email,
          phone: updateDto.general?.phone,
          mobile: updateDto.general?.mobile,
          category: updateDto.general?.category,
          cpf: updateDto.general?.cpf,
          rg: updateDto.general?.rg,
          cnpj: updateDto.general?.cnpj,
          activity: updateDto.general?.activity,
          notes: updateDto.general?.notes,
          minValue: updateDto.creditLimit?.minValue,
          maxValue: updateDto.creditLimit?.maxValue,
          blockClient: updateDto.creditLimit?.blockClient,
        },
      });

      // Atualizar endereços
      if (updateDto.addresses) {
        await this.prisma.address.deleteMany({
          where: { ownerId: id, ownerType: 'SUPPLIER' },
        });

        await Promise.all(
          updateDto.addresses.map((address) =>
            this.prisma.address.create({
              data: {
                type: address.type,
                zipcode: address.zipcode,
                state: address.state,
                city: address.city,
                neighborhood: address.neighborhood,
                street: address.street,
                number: address.number,
                complement: address.complement,
                ownerId: id,
                ownerType: 'SUPPLIER',
              },
            }),
          ),
        );
      }

      // Atualizar contatos
      if (updateDto.contacts) {
        await this.prisma.contact.deleteMany({
          where: { supplierId: id },
        });

        await Promise.all(
          updateDto.contacts.map((contact) =>
            this.prisma.contact.create({
              data: {
                name: contact.name,
                email: contact.email,
                phone: contact.phone,
                mobile: contact.mobile,
                notes: contact.notes,
                supplierId: id,
              },
            }),
          ),
        );
      }

      // Atualizar condições de pagamento
      if (updateDto.creditLimit?.conditions) {
        await this.prisma.supplierPaymentCondition.deleteMany({
          where: { supplierId: id },
        });

        await Promise.all(
          updateDto.creditLimit.conditions.map((condition) =>
            this.prisma.supplierPaymentCondition.create({
              data: {
                supplierId: id,
                paymentConditionId: condition.id,
                isActive: condition.isActive,
              },
            }),
          ),
        );
      }

      return this.findOne(id);
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

    if (dto.companyId) {
      update['company'] = { connect: { id: dto.companyId } };
    }

    return update;
  }

  private buildDetailsObject(dto: UpdateSupplierDto): Prisma.JsonValue {
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
