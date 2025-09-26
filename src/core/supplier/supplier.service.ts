import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { PrismaService } from 'nestjs-prisma';
import { SupplierFilterDTO } from './dto/filter.dto';
import { ClientStatus, OwnerType, Prisma } from '@prisma/client';

@Injectable()
export class SupplierService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createDto: CreateSupplierDto) {
    try {
      const supplier = await this.prisma.$transaction(async (prisma) => {
        // Criar o cliente
        const supplier = await prisma.supplier.create({
          data: {
            type: createDto.type,
            name: createDto.general.name,
            corporateName: createDto.general?.corporateName ?? null,
            email: createDto.general.email,
            phone: createDto.general.phone,
            mobile: createDto.general.mobile,
            companyId: createDto.companyId,
            category: createDto.general.category,
            categoryId:
              createDto.general.categoryId === ''
                ? null
                : createDto.general.categoryId,
            cpf: createDto.general.cpf,
            rg: createDto.general.rg,
            cnpj: createDto.general.cnpj,
            activity: createDto.general.activity,
            notes: createDto.general.notes,
            // minValue: createDto.creditLimit.minValue,
            // maxValue: createDto.creditLimit.maxValue,
            // blockClient: createDto.creditLimit.blockClient,
          },
        });

        // Criar endereços e associar ao cliente
        if (createDto.addresses?.length > 0) {
          for (const address of createDto.addresses) {
            await prisma.address.create({
              data: {
                type: address.type,
                zipcode: address.zipcode,
                state: address.state,
                city: address.city,
                neighborhood: address.neighborhood,
                street: address.street,
                number: address.number,
                supplierId: supplier.id,
                ownerType: 'SUPPLIER',
                complement: address.complement,
              },
            });

            // await prisma.supplier.update({
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
        if (createDto.contacts?.length > 0) {
          for (const contact of createDto.contacts) {
            await prisma.contact.create({
              data: {
                name: contact.name,
                email: contact.email,
                phone: contact.phone,
                mobile: contact.mobile,
                notes: contact.notes,
                supplierId: supplier.id,
              },
            });
          }
        }

        // Criar condições de pagamento do cliente
        // if (createDto.creditLimit.conditions?.length > 0) {
        //   for (const condition of createDto.creditLimit.conditions) {
        //     await prisma.supplierPaymentCondition.create({
        //       data: {
        //         supplierId: supplier.id,
        //         paymentConditionId: condition.id,
        //         isActive: condition.isActive,
        //       },
        //     });
        //   }
        // }

        // Retorna o cliente completo após criação

        return supplier;
      });

      return this.findOne(supplier.id);
    } catch (error) {
      console.error('Error creating client:', error);
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
            { corporateName: { contains: filter.search, mode: 'insensitive' } },
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

      // Configurar ordenação
      let orderBy = {};
      if (filter.orderBy) {
        orderBy = {
          [filter.orderBy]: filter.orderDirection || 'asc',
        };
      } else {
        // Ordenação padrão por nome (crescente)
        orderBy = {
          name: 'asc',
        };
      }

      const [total, suppliers] = await Promise.all([
        this.prisma.supplier.count({ where }),
        this.prisma.supplier.findMany({
          where: where,
          take: +filter.limit,
          skip: (+filter.page - 1) * +filter.limit,
          orderBy: orderBy,
          include: {
            categoryRelation: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        }),
      ]);

      const lastPage = Math.ceil(total / +filter.limit);

      return {
        total,
        lastPage,
        data: suppliers,
      };
    } catch (e) {
      console.error(e);
      throw new BadRequestException('Supplier list error');
    }
  }

  async findAllQuantity(companyId: string) {
    const allStatuses: ClientStatus[] = ['PROSPECT', 'ACTIVE', 'INACTIVE'];

    const result = await this.prisma.client.groupBy({
      by: ['status'],
      where: { companyId, status: { in: allStatuses } },
      _count: true,
    });

    const statusCount = allStatuses.reduce(
      (acc, status) => {
        acc[status] = 0;
        return acc;
      },
      {} as { [K in ClientStatus]: number },
    );

    result.forEach((cur) => {
      statusCount[cur.status] = cur._count;
    });

    const total = Object.values(statusCount).reduce((acc, cur) => acc + cur, 0);

    return {
      ...statusCount,
      TOTAL: total,
    };
  }

  async findOne(id: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      include: {
        contacts: true,
        address: true,
        categoryRelation: {
          select: {
            id: true,
            name: true,
          },
        },
        paymentConditions: {
          include: {
            paymentCondition: true,
          },
        },
      },
    });

    if (!supplier) {
      throw new NotFoundException('Supplier not found');
    }

    // Obter todas as condições de pagamento
    const allPaymentConditions = await this.prisma.paymentCondition.findMany({
      select: {
        id: true,
        name: true,
      },
    });

    // Agrupar condições de pagamento por método de pagamento
    const paymentMethodsMap = new Map();

    // Rastrear condições de pagamento associadas
    const associatedConditionIds = new Set(
      supplier.paymentConditions.map((pc) => pc.paymentCondition.id),
    );

    supplier.paymentConditions.forEach((pc) => {
      const method = pc.paymentCondition;
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

    // Adicionar condições de pagamento não associadas
    allPaymentConditions.forEach((condition) => {
      if (!associatedConditionIds.has(condition.id)) {
        if (!paymentMethodsMap.has(condition.id)) {
          paymentMethodsMap.set(condition.id, {
            id: condition.id,
            name: condition.name,
            conditions: [],
          });
        }
        paymentMethodsMap.get(condition.id).conditions.push({
          id: condition.id,
          name: condition.name,
          isActive: false,
        });
      }
    });

    // Transformar para o formato esperado pelo front
    return {
      type: supplier.type,
      status: supplier.status,
      general: {
        name: supplier.name,
        email: supplier.email,
        cpf: supplier.cpf,
        rg: supplier.rg,
        cnpj: supplier.cnpj,
        activity: supplier.activity,
        category: supplier.categoryRelation,
        categoryId: supplier.categoryId,
        phone: supplier.phone,
        mobile: supplier.mobile,
        notes: supplier.notes,
      },
      addresses: supplier.address.map((address) => ({
        type: address.type,
        zipcode: address.zipcode,
        state: address.state,
        city: address.city,
        neighborhood: address.neighborhood,
        street: address.street,
        number: address.number,
        complement: address.complement,
      })),
      contacts: supplier.contacts.map((contact) => ({
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        mobile: contact.mobile,
        notes: contact.notes,
      })),
      creditLimit: {
        minValue: supplier.minValue || 0,
        maxValue: supplier.maxValue || 0,
        paymentMethods: Array.from(paymentMethodsMap.values()),
        blockClient: supplier.blockClient,
      },
    };
  }

  async update(id: string, updateSupplierDto: UpdateSupplierDto) {
    try {
      const client = await this.prisma.supplier.findUnique({ where: { id } });
      if (!client) {
        throw new NotFoundException('SUPPLIER not found');
      }

      return await this.prisma.$transaction(async (prisma) => {
        // Atualizar dados do cliente
        await prisma.supplier.update({
          where: { id },
          data: {
            name: updateSupplierDto.general?.name,
            email: updateSupplierDto.general?.email,
            phone: updateSupplierDto.general?.phone,
            mobile: updateSupplierDto.general?.mobile,
            category: updateSupplierDto.general?.category,
            categoryId:
              updateSupplierDto.general?.categoryId === ''
                ? null
                : updateSupplierDto.general?.categoryId,
            cpf: updateSupplierDto.general?.cpf,
            rg: updateSupplierDto.general?.rg,
            cnpj: updateSupplierDto.general?.cnpj,
            activity: updateSupplierDto.general?.activity,
            notes: updateSupplierDto.general?.notes,
            minValue: updateSupplierDto.creditLimit?.minValue,
            maxValue: updateSupplierDto.creditLimit?.maxValue,
            blockClient: updateSupplierDto.creditLimit?.blockClient,
            status: updateSupplierDto.status,
          },
        });

        // Atualizar endereços
        if (updateSupplierDto.addresses) {
          await prisma.address.deleteMany({
            where: { ownerId: id, ownerType: 'SUPPLIER' },
          });

          for (const address of updateSupplierDto.addresses) {
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
                supplierId: id,
                ownerType: 'SUPPLIER',
              },
            });

            // await prisma.supplier.update({
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
        if (updateSupplierDto.contacts) {
          await prisma.contact.deleteMany({
            where: { supplierId: id },
          });

          for (const contact of updateSupplierDto.contacts) {
            await prisma.contact.create({
              data: {
                name: contact.name,
                email: contact.email,
                phone: contact.phone,
                mobile: contact.mobile,
                notes: contact.notes,
                supplierId: id,
              },
            });
          }
        }

        // Atualizar condições de pagamento
        if (updateSupplierDto.creditLimit?.conditions) {
          await prisma.supplierPaymentCondition.deleteMany({
            where: { supplierId: id },
          });

          for (const condition of updateSupplierDto.creditLimit.conditions) {
            await prisma.supplierPaymentCondition.create({
              data: {
                supplierId: id,
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
