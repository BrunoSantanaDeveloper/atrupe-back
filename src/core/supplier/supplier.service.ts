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
import { assertBelongsToCompany } from 'src/shared/tenant/company-scope';

const EXPORT_LIMIT = '10000';

@Injectable()
export class SupplierService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Remove pontuação de CPF/CNPJ para normalização
   */
  private normalizeDocument(
    document: string | null | undefined,
  ): string | null {
    if (!document) return null;
    return document.replace(/[.\-/]/g, '');
  }

  /**
   * O grupo e as condições do limite de crédito vêm no corpo: precisam ser da
   * empresa (o grupo pode ser o padrão do sistema)
   */
  private async assertRefsOfCompany(
    companyId: string,
    refs: {
      categoryId?: string | null;
      conditionIds?: (string | null | undefined)[];
    },
  ) {
    await assertBelongsToCompany(
      this.prisma.category,
      refs.categoryId,
      { OR: [{ companyId }, { isStandard: true }] },
      'Grupo não encontrado.',
    );
    await assertBelongsToCompany(
      this.prisma.paymentCondition,
      refs.conditionIds,
      { companyId },
      'Condição de pagamento não encontrada.',
    );
  }

  /** As colunas dos dados de pagamento, só as que vieram no corpo. */
  private paymentData(payment?: {
    pixKey?: string | null;
    bankName?: string | null;
    bankAgency?: string | null;
    bankAccount?: string | null;
    accountHolder?: string | null;
    paymentTerms?: string | null;
  }) {
    if (!payment) return {};
    const clean = (value?: string | null) =>
      value === undefined ? undefined : value?.trim() || null;
    return {
      pixKey: clean(payment.pixKey),
      bankName: clean(payment.bankName),
      bankAgency: clean(payment.bankAgency),
      bankAccount: clean(payment.bankAccount),
      accountHolder: clean(payment.accountHolder),
      paymentTerms: clean(payment.paymentTerms),
    };
  }

  async create(createDto: CreateSupplierDto) {
    await this.assertRefsOfCompany(createDto.companyId, {
      categoryId: createDto.general?.categoryId,
      conditionIds: createDto.creditLimit?.conditions?.map(
        (condition) => condition.id,
      ),
    });

    try {
      // Validar duplicidade de documento (CPF/CNPJ)
      // Ignora se o registro atual é filial OU se os registros existentes são filiais
      if (!createDto.general.isBranch) {
        const cpf = createDto.general.cpf;
        const cnpj = createDto.general.cnpj;

        if (cpf) {
          const existingSupplier = await this.prisma.supplier.findFirst({
            where: {
              cpf: cpf,
              companyId: createDto.companyId,
              isBranch: false, // Só valida se o existente NÃO for filial
            },
          });

          if (existingSupplier) {
            throw new BadRequestException(
              `Já existe um fornecedor cadastrado com o CPF ${cpf}`,
            );
          }
        }

        if (cnpj) {
          const existingSupplier = await this.prisma.supplier.findFirst({
            where: {
              cnpj: cnpj,
              companyId: createDto.companyId,
              isBranch: false, // Só valida se o existente NÃO for filial
            },
          });

          if (existingSupplier) {
            throw new BadRequestException(
              `Já existe um fornecedor cadastrado com o CNPJ ${cnpj}`,
            );
          }
        }
      }

      const supplier = await this.prisma.$transaction(async (prisma) => {
        // Criar o fornecedor
        const supplier = await prisma.supplier.create({
          data: {
            type: createDto.type,
            name: createDto.general.name,
            corporateName: createDto.general?.corporateName ?? null,
            email: createDto.general.email,
            phone: createDto.general.phone,
            mobile: createDto.general.mobile,
            companyId: createDto.companyId,
            categoryId:
              createDto.general.categoryId === ''
                ? null
                : createDto.general.categoryId,
            cpf: this.normalizeDocument(createDto.general.cpf),
            rg: createDto.general.rg,
            cnpj: this.normalizeDocument(createDto.general.cnpj),
            activity: createDto.general.activity,
            notes: createDto.general.notes,
            isBranch: createDto.general.isBranch || false,
            ...this.paymentData(createDto.payment),
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
        // Normalizar busca para documentos (remover pontuação)
        const normalizedSearch = this.normalizeDocument(filter.search);

        where = {
          ...where,
          OR: [
            { name: { contains: filter.search, mode: 'insensitive' } },
            { corporateName: { contains: filter.search, mode: 'insensitive' } },
            { email: { contains: filter.search, mode: 'insensitive' } },
            { cpf: { contains: normalizedSearch, mode: 'insensitive' } },
            { cnpj: { contains: normalizedSearch, mode: 'insensitive' } },
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
            category: {
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
        data: suppliers.map(({ category, ...rest }) => ({
          ...rest,
          categoryRelation: category,
        })),
      };
    } catch (e) {
      console.error(e);
      throw new BadRequestException('Supplier list error');
    }
  }

  async findAllForExport(filter: SupplierFilterDTO) {
    const result = await this.findAll({
      ...filter,
      page: '1',
      limit: EXPORT_LIMIT,
    });

    return {
      total: result.total,
      exportLimit: Number(EXPORT_LIMIT),
      data: result.data,
    };
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
        category: {
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
      createdAt: supplier.createdAt,
      payment: {
        pixKey: supplier.pixKey,
        bankName: supplier.bankName,
        bankAgency: supplier.bankAgency,
        bankAccount: supplier.bankAccount,
        accountHolder: supplier.accountHolder,
        paymentTerms: supplier.paymentTerms,
      },
      general: {
        name: supplier.name,
        email: supplier.email,
        cpf: supplier.cpf,
        rg: supplier.rg,
        cnpj: supplier.cnpj,
        activity: supplier.activity,
        category: supplier.category,
        categoryId: supplier.categoryId,
        phone: supplier.phone,
        mobile: supplier.mobile,
        notes: supplier.notes,
        isBranch: supplier.isBranch || false,
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
    const owner = await this.prisma.supplier.findUnique({
      where: { id },
      select: { companyId: true },
    });
    // Sem o fornecedor, o fluxo abaixo responde o 404
    if (owner) {
      await this.assertRefsOfCompany(owner.companyId, {
        categoryId: updateSupplierDto.general?.categoryId,
        conditionIds: updateSupplierDto.creditLimit?.conditions?.map(
          (condition) => condition.id,
        ),
      });
    }

    try {
      const supplier = await this.prisma.supplier.findUnique({ where: { id } });
      if (!supplier) {
        throw new NotFoundException('SUPPLIER not found');
      }

      // Validar duplicidade de documento (CPF/CNPJ) se estiver sendo alterado
      // Ignora se o registro atual é filial OU se os registros existentes são filiais
      const isBecomingNonBranch =
        updateSupplierDto.general?.isBranch === false &&
        supplier.isBranch === true;
      const shouldValidate =
        updateSupplierDto.general?.isBranch === false || isBecomingNonBranch;

      if (shouldValidate) {
        const cpf = updateSupplierDto.general?.cpf ?? supplier.cpf;
        const cnpj = updateSupplierDto.general?.cnpj ?? supplier.cnpj;

        if (cpf) {
          const existingSupplier = await this.prisma.supplier.findFirst({
            where: {
              cpf: cpf,
              companyId: supplier.companyId,
              id: { not: id },
              isBranch: false, // Só valida se o existente NÃO for filial
            },
          });

          if (existingSupplier) {
            throw new BadRequestException(
              `Já existe um fornecedor cadastrado com o CPF ${cpf}`,
            );
          }
        }

        if (cnpj) {
          const existingSupplier = await this.prisma.supplier.findFirst({
            where: {
              cnpj: cnpj,
              companyId: supplier.companyId,
              id: { not: id },
              isBranch: false, // Só valida se o existente NÃO for filial
            },
          });

          if (existingSupplier) {
            throw new BadRequestException(
              `Já existe um fornecedor cadastrado com o CNPJ ${cnpj}`,
            );
          }
        }
      }

      return await this.prisma.$transaction(async (prisma) => {
        // Atualizar dados do fornecedor
        await prisma.supplier.update({
          where: { id },
          data: {
            name: updateSupplierDto.general?.name,
            email: updateSupplierDto.general?.email,
            phone: updateSupplierDto.general?.phone,
            mobile: updateSupplierDto.general?.mobile,
            categoryId:
              updateSupplierDto.general?.categoryId === ''
                ? null
                : updateSupplierDto.general?.categoryId,
            cpf: updateSupplierDto.general?.cpf
              ? this.normalizeDocument(updateSupplierDto.general.cpf)
              : undefined,
            rg: updateSupplierDto.general?.rg,
            cnpj: updateSupplierDto.general?.cnpj
              ? this.normalizeDocument(updateSupplierDto.general.cnpj)
              : undefined,
            activity: updateSupplierDto.general?.activity,
            notes: updateSupplierDto.general?.notes,
            minValue: updateSupplierDto.creditLimit?.minValue,
            maxValue: updateSupplierDto.creditLimit?.maxValue,
            blockClient: updateSupplierDto.creditLimit?.blockClient,
            ...this.paymentData(updateSupplierDto.payment),
            isBranch: updateSupplierDto.general?.isBranch,
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

  async toggleStatus(id: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      select: { id: true, status: true },
    });

    if (!supplier) {
      throw new NotFoundException('Supplier not found');
    }

    const newStatus =
      supplier.status === ClientStatus.ACTIVE
        ? ClientStatus.INACTIVE
        : ClientStatus.ACTIVE;

    return await this.prisma.supplier.update({
      where: { id },
      data: { status: newStatus },
      select: {
        id: true,
        status: true,
        name: true,
        email: true,
      },
    });
  }

  remove(id: string) {
    return this.prisma.supplier.delete({
      where: { id: id },
    });
  }

  async convertToClient(supplierId: string, companyId: string) {
    // 1. Buscar o fornecedor com todos os dados
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      include: {
        contacts: true,
        address: {
          where: { ownerType: 'SUPPLIER' },
        },
      },
    });

    if (!supplier) {
      throw new NotFoundException('Fornecedor não encontrado');
    }

    if (supplier.companyId !== companyId) {
      throw new BadRequestException('Fornecedor não pertence a esta empresa');
    }

    // 2. Verificar se já existe cliente com mesmo CPF ou CNPJ
    if (supplier.cpf) {
      const existing = await this.prisma.client.findFirst({
        where: { cpf: supplier.cpf, companyId, isBranch: false },
      });
      if (existing) {
        throw new BadRequestException(
          `Já existe um cliente cadastrado com o CPF ${supplier.cpf}`,
        );
      }
    }

    if (supplier.cnpj) {
      const existing = await this.prisma.client.findFirst({
        where: { cnpj: supplier.cnpj, companyId, isBranch: false },
      });
      if (existing) {
        throw new BadRequestException(
          `Já existe um cliente cadastrado com o CNPJ ${supplier.cnpj}`,
        );
      }
    }

    // 3. Criar cliente com os mesmos dados em uma transação
    const client = await this.prisma.$transaction(
      async (prisma) => {
        const client = await prisma.client.create({
          data: {
            type: supplier.type,
            name: supplier.name,
            corporateName: supplier.corporateName,
            email: supplier.email,
            phone: supplier.phone,
            mobile: supplier.mobile,
            companyId: supplier.companyId,
            categoryId: supplier.categoryId,
            cpf: supplier.cpf,
            rg: supplier.rg,
            cnpj: supplier.cnpj,
            activity: supplier.activity,
            notes: supplier.notes,
            isBranch: supplier.isBranch || false,
          },
        });

        // Copiar endereços
        if (supplier.address?.length > 0) {
          await prisma.address.createMany({
            data: supplier.address.map((addr) => ({
              type: addr.type,
              zipcode: addr.zipcode,
              state: addr.state,
              city: addr.city,
              neighborhood: addr.neighborhood,
              street: addr.street,
              number: addr.number,
              complement: addr.complement,
              ownerId: client.id,
              ownerType: 'CLIENT' as const,
            })),
          });
        }

        // Copiar contatos
        if (supplier.contacts?.length > 0) {
          await prisma.contact.createMany({
            data: supplier.contacts.map((contact) => ({
              name: contact.name,
              email: contact.email,
              phone: contact.phone,
              mobile: contact.mobile,
              notes: contact.notes,
              clientId: client.id,
            })),
          });
        }

        return client;
      },
      { timeout: 10000 },
    );

    return {
      message: 'Cliente criado com sucesso a partir do fornecedor',
      clientId: client.id,
    };
  }
}
