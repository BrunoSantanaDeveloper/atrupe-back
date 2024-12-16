import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { PrismaService } from 'nestjs-prisma';
import { ClientFilterDTO } from './dto/filter.dto';
import { OwnerType, Prisma } from '@prisma/client';

@Injectable()
export class ClientService {
  constructor(private readonly prisma: PrismaService) {}
  async create(createClientDto: CreateClientDto) {
    try {
      return await this.prisma.$transaction(async (prisma) => {
        // Criar o cliente
        const client = await prisma.client.create({
          data: {
            type: createClientDto.type,
            name: createClientDto.general.name,
            email: createClientDto.general.email,
            phone: createClientDto.general.phone,
            mobile: createClientDto.general.mobile,
            companyId: createClientDto.companyId,
            category: createClientDto.general.category,
            cpf: createClientDto.general.cpf,
            rg: createClientDto.general.rg,
            cnpj: createClientDto.general.cnpj,
            activity: createClientDto.general.activity,
            notes: createClientDto.general.notes,
            minValue: createClientDto.creditLimit.minValue,
            maxValue: createClientDto.creditLimit.maxValue,
            blockClient: createClientDto.creditLimit.blockClient,
          },
        });

        // Criar endereços e associar ao cliente
        if (createClientDto.addresses?.length > 0) {
          for (const address of createClientDto.addresses) {
            await prisma.address.create({
              data: {
                type: address.type,
                zipcode: address.zipcode,
                state: address.state,
                city: address.city,
                neighborhood: address.neighborhood,
                street: address.street,
                number: address.number,
                ownerId: client.id,
                ownerType: 'CLIENT',
                complement: address.complement,
              },
            });

            // await prisma.client.update({
            //   where: { id: client.id },
            //   data: {
            //     address: {
            //       connect: { id: createdAddress.id },
            //     },
            //   },
            // });
          }
        }

        // Criar contatos
        if (createClientDto.contacts?.length > 0) {
          for (const contact of createClientDto.contacts) {
            await prisma.contact.create({
              data: {
                name: contact.name,
                email: contact.email,
                phone: contact.phone,
                mobile: contact.mobile,
                notes: contact.notes,
                clientId: client.id,
              },
            });
          }
        }

        // Criar condições de pagamento do cliente
        if (createClientDto.creditLimit.conditions?.length > 0) {
          for (const condition of createClientDto.creditLimit.conditions) {
            await prisma.clientPaymentCondition.create({
              data: {
                clientId: client.id,
                paymentConditionId: condition.id,
                isActive: condition.isActive,
              },
            });
          }
        }

        // Retorna o cliente completo após criação
        return this.findOne(client.id);
      });
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
            { cpf: { contains: filter.search, mode: 'insensitive' } },
            { cnpj: { contains: filter.search, mode: 'insensitive' } },
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
    const client = await this.prisma.client.findUnique({
      where: { id },
      include: {
        contacts: true,
        address: true,
        paymentConditions: {
          include: {
            paymentCondition: {
              include: {
                paymentMethod: true,
              },
            },
          },
        },
      },
    });

    if (!client) {
      throw new NotFoundException('Client not found');
    }

    // Agrupar condições de pagamento por método de pagamento
    const paymentMethodsMap = new Map();
    client.paymentConditions.forEach((pc) => {
      const method = pc.paymentCondition.paymentMethod;
      if (!paymentMethodsMap.has(method.id)) {
        paymentMethodsMap.set(method.id, {
          id: method.id,
          name: method.name,
          conditions: [],
        });
      }
      paymentMethodsMap.get(method.id).conditions.push({
        id: pc.paymentCondition.id,
        name: pc.paymentCondition.name,
        isActive: pc.isActive,
      });
    });

    // Transformar para o formato esperado pelo front
    return {
      type: client.type,
      general: {
        name: client.name,
        email: client.email,
        cpf: client.cpf,
        rg: client.rg,
        cnpj: client.cnpj,
        activity: client.activity,
        category: client.category,
        phone: client.phone,
        mobile: client.mobile,
        notes: client.notes,
      },
      addresses: client.address.map((address) => ({
        type: address.type,
        zipcode: address.zipcode,
        state: address.state,
        city: address.city,
        neighborhood: address.neighborhood,
        street: address.street,
        number: address.number,
        complement: address.complement,
      })),
      contacts: client.contacts.map((contact) => ({
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        mobile: contact.mobile,
        notes: contact.notes,
      })),
      creditLimit: {
        minValue: client.minValue || 0,
        maxValue: client.maxValue || 0,
        paymentMethods: Array.from(paymentMethodsMap.values()),
        blockClient: client.blockClient,
      },
    };
  }

  async update(id: string, updateClientDto: UpdateClientDto) {
    try {
      const client = await this.prisma.client.findUnique({ where: { id } });
      if (!client) {
        throw new NotFoundException('Client not found');
      }

      return await this.prisma.$transaction(async (prisma) => {
        // Atualizar dados do cliente
        await prisma.client.update({
          where: { id },
          data: {
            name: updateClientDto.general?.name,
            email: updateClientDto.general?.email,
            phone: updateClientDto.general?.phone,
            mobile: updateClientDto.general?.mobile,
            category: updateClientDto.general?.category,
            cpf: updateClientDto.general?.cpf,
            rg: updateClientDto.general?.rg,
            cnpj: updateClientDto.general?.cnpj,
            activity: updateClientDto.general?.activity,
            notes: updateClientDto.general?.notes,
            minValue: updateClientDto.creditLimit?.minValue,
            maxValue: updateClientDto.creditLimit?.maxValue,
            blockClient: updateClientDto.creditLimit?.blockClient,
          },
        });

        // Atualizar endereços
        if (updateClientDto.addresses) {
          await prisma.address.deleteMany({
            where: { ownerId: id, ownerType: 'CLIENT' },
          });

          for (const address of updateClientDto.addresses) {
            await prisma.address.create({
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
                ownerType: 'CLIENT',
              },
            });

            // await prisma.client.update({
            //   where: { id },
            //   data: {
            //     address: {
            //       connect: { id: createdAddress.id },
            //     },
            //   },
            // });
          }
        }

        // Atualizar contatos
        if (updateClientDto.contacts) {
          await prisma.contact.deleteMany({
            where: { clientId: id },
          });

          for (const contact of updateClientDto.contacts) {
            await prisma.contact.create({
              data: {
                name: contact.name,
                email: contact.email,
                phone: contact.phone,
                mobile: contact.mobile,
                notes: contact.notes,
                clientId: id,
              },
            });
          }
        }

        // Atualizar condições de pagamento
        if (updateClientDto.creditLimit?.conditions) {
          await prisma.clientPaymentCondition.deleteMany({
            where: { clientId: id },
          });

          for (const condition of updateClientDto.creditLimit.conditions) {
            await prisma.clientPaymentCondition.create({
              data: {
                clientId: id,
                paymentConditionId: condition.id,
                isActive: condition.isActive,
              },
            });
          }
        }

        return this.findOne(id);
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
