import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateClientDto, PreRegisterClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { PrismaService } from 'nestjs-prisma';
import { ClientFilterDTO } from './dto/filter.dto';
import { ClientKind, ClientStatus, OwnerType, Prisma } from '@prisma/client';
import * as fs from 'fs';
import * as fastCsv from 'fast-csv';

@Injectable()
export class ClientService {
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
   * Determina o status do cliente baseado nos dados fornecidos
   * Regras:
   * - Se tiver só o nome: PROSPECT
   * - Se tiver nome, CPF/CNPJ, endereço e telefone: ACTIVE
   */
  private determineClientStatus(
    name: string,
    cpfCnpj: string | undefined,
    addresses: any[] | undefined,
    phone: string | undefined,
    mobile: string | undefined,
  ): ClientStatus {
    // Verifica se tem nome (obrigatório)
    if (!name) {
      return 'PROSPECT';
    }

    // Verifica se tem CPF ou CNPJ
    const hasCpfCnpj = !!cpfCnpj;

    // Verifica se tem pelo menos um endereço válido
    // (deve ter CEP, estado, cidade, bairro e rua preenchidos)
    const hasAddress =
      addresses &&
      addresses.length > 0 &&
      addresses.some(
        (addr) =>
          addr.zipcode &&
          addr.state &&
          addr.city &&
          addr.neighborhood &&
          addr.street,
      );

    // Verifica se tem telefone (phone ou mobile)
    const hasPhone = !!phone || !!mobile;

    // Se tiver nome, CPF/CNPJ, endereço e telefone: ACTIVE
    if (hasCpfCnpj && hasAddress && hasPhone) {
      return 'ACTIVE';
    }

    // Caso contrário: PROSPECT
    return 'PROSPECT';
  }

  async create(createClientDto: CreateClientDto, sellerId: string) {
    try {
      await this.verifySellerPermission(sellerId);

      // Validar duplicidade de documento (CPF/CNPJ)
      // Ignora se o registro atual é filial OU se os registros existentes são filiais
      if (!createClientDto.general.isBranch) {
        const cpf = createClientDto.general.cpf;
        const cnpj = createClientDto.general.cnpj;

        if (cpf) {
          const existingClient = await this.prisma.client.findFirst({
            where: {
              cpf: cpf,
              companyId: createClientDto.companyId,
              isBranch: false, // Só valida se o existente NÃO for filial
            },
          });

          if (existingClient) {
            throw new BadRequestException(
              `Já existe um cliente cadastrado com o CPF ${cpf}`,
            );
          }
        }

        if (cnpj) {
          const existingClient = await this.prisma.client.findFirst({
            where: {
              cnpj: cnpj,
              companyId: createClientDto.companyId,
              isBranch: false, // Só valida se o existente NÃO for filial
            },
          });

          if (existingClient) {
            throw new BadRequestException(
              `Já existe um cliente cadastrado com o CNPJ ${cnpj}`,
            );
          }
        }
      }

      // Determina o status baseado nos dados fornecidos
      const cpfCnpj =
        createClientDto.general.cpf || createClientDto.general.cnpj;
      const autoStatus = this.determineClientStatus(
        createClientDto.general.name,
        cpfCnpj,
        createClientDto.addresses,
        createClientDto.general.phone,
        createClientDto.general.mobile,
      );

      const client = await this.prisma.$transaction(
        async (prisma) => {
          // Criar o cliente
          const client = await prisma.client.create({
            data: {
              type: createClientDto.type,
              name: createClientDto.general.name,
              email: createClientDto.general.email,
              phone: createClientDto.general.phone,
              mobile: createClientDto.general.mobile,
              companyId: createClientDto.companyId,
              categoryId: createClientDto.general.categoryId?.trim() || null,
              cpf: this.normalizeDocument(createClientDto.general.cpf),
              rg: createClientDto.general.rg,
              cnpj: this.normalizeDocument(createClientDto.general.cnpj),
              activity: createClientDto.general.activity,
              corporateName: createClientDto.general.corporateName,
              notes: createClientDto.general.notes,
              birthdate: createClientDto.general.birthdate
                ? new Date(createClientDto.general.birthdate)
                : null,
              minValue: createClientDto.creditLimit?.minValue || 0,
              maxValue: createClientDto.creditLimit?.maxValue || 0,
              blockClient: createClientDto.creditLimit?.blockClient || false,
              status: autoStatus,
              isBranch: createClientDto.general.isBranch || false,
            },
          });

          // Criar endereços usando createMany para melhor performance
          if (createClientDto.addresses?.length > 0) {
            await prisma.address.createMany({
              data: createClientDto.addresses.map((address) => ({
                type: address.type,
                zipcode: address.zipcode,
                state: address.state,
                city: address.city,
                neighborhood: address.neighborhood,
                street: address.street,
                number: address.number,
                ownerId: client.id,
                ownerType: 'CLIENT' as const,
                complement: address.complement,
              })),
            });
          }

          // Criar contatos usando createMany para melhor performance
          if (createClientDto.contacts?.length > 0) {
            await prisma.contact.createMany({
              data: createClientDto.contacts.map((contact) => ({
                name: contact.name,
                email: contact.email,
                phone: contact.phone,
                mobile: contact.mobile,
                notes: contact.notes,
                clientId: client.id,
              })),
            });
          }

          // Criar condições de pagamento usando createMany para melhor performance
          if (createClientDto.creditLimit?.conditions?.length > 0) {
            await prisma.clientPaymentCondition.createMany({
              data: createClientDto.creditLimit.conditions.map((condition) => ({
                clientId: client.id,
                paymentConditionId: condition.id,
                isActive: condition.isActive,
              })),
            });
          }

          // Retorna o cliente completo após criação
          return client;
        },
        {
          timeout: 10000, // Aumenta timeout para 10 segundos
        },
      );
      return this.findOne(client.id);
    } catch (error) {
      console.error('Erro ao criar cliente:', error);
      throw error;
    }
  }

  async preRegisterClient(preRegisterClientDto: PreRegisterClientDto) {
    try {
      return await this.prisma.client.create({
        data: {
          type: preRegisterClientDto.type,
          name: preRegisterClientDto.name,
          email: preRegisterClientDto.email || null,
          phone: preRegisterClientDto.phone || null,
          mobile: preRegisterClientDto.mobile || null,
          categoryId: preRegisterClientDto.categoryId?.trim() || null,
          status: 'PROSPECT',
          companyId: preRegisterClientDto.companyId,
          rg:
            preRegisterClientDto.type === ClientKind.PERSON
              ? preRegisterClientDto.rg || null
              : null,
          cpf:
            preRegisterClientDto.type === ClientKind.PERSON
              ? preRegisterClientDto.cpf || null
              : null,
          cnpj:
            preRegisterClientDto.type === ClientKind.COMPANY
              ? preRegisterClientDto.cnpj || null
              : null,
          activity:
            preRegisterClientDto.type === ClientKind.COMPANY
              ? preRegisterClientDto.activity || null
              : null,
          tradeName:
            preRegisterClientDto.type === ClientKind.COMPANY
              ? preRegisterClientDto.tradeName || null
              : null,
          corporateName:
            preRegisterClientDto.type === ClientKind.COMPANY
              ? preRegisterClientDto.corporateName || null
              : null,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException(
          `O e-mail já está registrado na empresa.`,
        );
      }
      console.error('Erro durante o pré-registro:', error);
      throw new BadRequestException(
        'Erro durante o pré-registro:',
        error.message,
      );
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

  async findAll(filter: ClientFilterDTO) {
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
          [filter.orderBy]: filter.orderDirection || 'desc',
        };
      } else {
        // Ordenação padrão por nome (crescente)
        orderBy = {
          name: 'asc',
        };
      }

      const [total, clients] = await Promise.all([
        this.prisma.client.count({ where }),
        this.prisma.client.findMany({
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

    if (!client) {
      throw new NotFoundException('Client not found');
    }

    // Obter todas as condições de pagamento
    const allPaymentConditions = await this.prisma.paymentCondition.findMany({
      where: {
        companyId: client.companyId,
      },
      select: {
        id: true,
        name: true,
      },
    });

    // Agrupar condições de pagamento por método de pagamento
    const paymentMethodsMap = new Map();

    // Rastrear condições de pagamento associadas
    const associatedConditionIds = new Set(
      client.paymentConditions.map((pc) => pc.paymentCondition.id),
    );

    client.paymentConditions.forEach((pc) => {
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
      type: client.type,
      status: client.status,
      createdAt: client.createdAt,
      general: {
        name: client.name,
        corporateName: client.corporateName,
        email: client.email,
        cpf: client.cpf,
        rg: client.rg,
        cnpj: client.cnpj,
        activity: client.activity,
        category: client.category,
        phone: client.phone,
        mobile: client.mobile,
        notes: client.notes,
        birthdate: client.birthdate?.toISOString().split('T')[0] || null,
        isBranch: client.isBranch || false,
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

  private async verifySellerPermission(sellerId) {
    const user = await this.prisma.user.findUnique({
      where: {
        id: sellerId,
      },
      select: {
        employee: {
          select: {
            role: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });
    if (user.employee[0].role.name === 'Admin') {
      return;
    }
    const seller = await this.prisma.sellerProfile.findFirst({
      where: {
        employees: {
          some: {
            user: {
              id: sellerId,
            },
          },
        },
      },
      select: {
        id: true,
        canApprovePreRegistration: true,
      },
    });

    if (!seller) {
      throw new NotFoundException('Seller not found');
    }

    if (!seller.canApprovePreRegistration) {
      throw new ForbiddenException(
        'Você não tem permissão para aprovar um pré-cadastro de um cliente.',
      );
    }
  }

  async findClientContacts(clientId: string) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      include: {
        contacts: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            mobile: true,
            sector: true,
            notes: true,
          },
        },
      },
    });

    if (!client) {
      throw new NotFoundException('Cliente não encontrado');
    }

    return client.contacts;
  }

  async update(id: string, updateClientDto: UpdateClientDto, sellerId: string) {
    try {
      const client = await this.prisma.client.findUnique({ where: { id } });
      if (!client) {
        throw new NotFoundException('Client not found');
      }

      // Validar duplicidade de documento (CPF/CNPJ) se estiver sendo alterado
      // Ignora se o registro atual é filial OU se os registros existentes são filiais
      const isBecomingNonBranch =
        updateClientDto.general?.isBranch === false && client.isBranch === true;
      const shouldValidate =
        updateClientDto.general?.isBranch === false || isBecomingNonBranch;

      if (shouldValidate) {
        const cpf = updateClientDto.general?.cpf ?? client.cpf;
        const cnpj = updateClientDto.general?.cnpj ?? client.cnpj;

        if (cpf) {
          const existingClient = await this.prisma.client.findFirst({
            where: {
              cpf: cpf,
              companyId: client.companyId,
              id: { not: id },
              isBranch: false, // Só valida se o existente NÃO for filial
            },
          });

          if (existingClient) {
            throw new BadRequestException(
              `Já existe um cliente cadastrado com o CPF ${cpf}`,
            );
          }
        }

        if (cnpj) {
          const existingClient = await this.prisma.client.findFirst({
            where: {
              cnpj: cnpj,
              companyId: client.companyId,
              id: { not: id },
              isBranch: false, // Só valida se o existente NÃO for filial
            },
          });

          if (existingClient) {
            throw new BadRequestException(
              `Já existe um cliente cadastrado com o CNPJ ${cnpj}`,
            );
          }
        }
      }

      // Determinar o status automaticamente baseado nos dados atualizados
      // Se o status atual for INACTIVE, não altera
      let finalStatus: ClientStatus | undefined = undefined;

      if (client.status !== 'INACTIVE') {
        // Combinar dados atuais com dados atualizados
        const updatedName = updateClientDto.general?.name || client.name;
        const updatedCpf = updateClientDto.general?.cpf ?? client.cpf;
        const updatedCnpj = updateClientDto.general?.cnpj ?? client.cnpj;
        const cpfCnpj = updatedCpf || updatedCnpj;
        const updatedPhone = updateClientDto.general?.phone ?? client.phone;
        const updatedMobile = updateClientDto.general?.mobile ?? client.mobile;

        // Verificar endereços: se estiver atualizando, usa os novos, senão busca os existentes
        let addressesToCheck: any[] | undefined = undefined;
        if (updateClientDto.addresses !== undefined) {
          addressesToCheck = updateClientDto.addresses;
        } else {
          // Buscar endereços existentes
          const existingAddresses = await this.prisma.address.findMany({
            where: { ownerId: id, ownerType: 'CLIENT' },
          });
          addressesToCheck = existingAddresses;
        }

        // Determina o status baseado nos dados combinados
        const calculatedStatus = this.determineClientStatus(
          updatedName,
          cpfCnpj,
          addressesToCheck,
          updatedPhone,
          updatedMobile,
        );

        // Se o status calculado for ACTIVE e o status atual não for ACTIVE,
        // precisa verificar permissão para aprovar
        if (calculatedStatus === 'ACTIVE' && client.status !== 'ACTIVE') {
          // Verificar se tem permissão para aprovar
          let canApprove = false;

          const seller = await this.prisma.sellerProfile.findFirst({
            where: {
              employees: {
                some: {
                  user: {
                    id: sellerId,
                  },
                },
              },
            },
            select: {
              id: true,
              canApprovePreRegistration: true,
            },
          });

          // Se não encontrou um seller profile, verificar se é admin
          if (!seller) {
            const user = await this.prisma.user.findUnique({
              where: {
                id: sellerId,
              },
              select: {
                employee: {
                  select: {
                    role: {
                      select: {
                        name: true,
                      },
                    },
                  },
                },
              },
            });

            // Se for Admin, pode aprovar
            if (user?.employee?.[0]?.role?.name === 'Admin') {
              canApprove = true;
            }
          } else if (seller.canApprovePreRegistration) {
            // Se encontrou o seller e ele tem permissão
            canApprove = true;
          }

          // Se tem permissão, usa ACTIVE, senão mantém PROSPECT
          if (canApprove) {
            finalStatus = 'ACTIVE';
          } else {
            finalStatus = 'PROSPECT';
            console.log(
              `Usuário ${sellerId} não tem permissão para aprovar cliente. Status mantido como PROSPECT.`,
            );
          }
        } else {
          // Para outros casos, usa o status calculado
          finalStatus = calculatedStatus;
        }
      }

      return await this.prisma
        .$transaction(
          async (prisma) => {
            // Atualizar dados do cliente
            await prisma.client.update({
              where: { id },
              data: {
                name: updateClientDto.general?.name,
                email: updateClientDto.general?.email,
                phone: updateClientDto.general?.phone,
                mobile: updateClientDto.general?.mobile,
                categoryId:
                  updateClientDto.general?.categoryId?.trim() || undefined,
                cpf: updateClientDto.general?.cpf
                  ? this.normalizeDocument(updateClientDto.general.cpf)
                  : undefined,
                rg: updateClientDto.general?.rg,
                cnpj: updateClientDto.general?.cnpj
                  ? this.normalizeDocument(updateClientDto.general.cnpj)
                  : undefined,
                activity: updateClientDto.general?.activity,
                notes: updateClientDto.general?.notes,
                birthdate: updateClientDto.general?.birthdate
                  ? new Date(updateClientDto.general.birthdate)
                  : undefined,
                minValue: updateClientDto.creditLimit?.minValue,
                maxValue: updateClientDto.creditLimit?.maxValue,
                blockClient: updateClientDto.creditLimit?.blockClient,
                status: finalStatus,
                isBranch: updateClientDto.general?.isBranch,
              },
            });

            // Atualizar endereços usando createMany para melhor performance
            if (updateClientDto.addresses) {
              await prisma.address.deleteMany({
                where: { ownerId: id, ownerType: 'CLIENT' },
              });

              if (updateClientDto.addresses.length > 0) {
                await prisma.address.createMany({
                  data: updateClientDto.addresses.map((address) => ({
                    type: address.type,
                    zipcode: address.zipcode,
                    state: address.state,
                    city: address.city,
                    neighborhood: address.neighborhood,
                    street: address.street,
                    number: address.number,
                    complement: address.complement,
                    ownerId: id,
                    ownerType: 'CLIENT' as const,
                  })),
                });
              }
            }

            // Atualizar contatos usando createMany para melhor performance
            if (updateClientDto.contacts) {
              await prisma.contact.deleteMany({
                where: { clientId: id },
              });

              if (updateClientDto.contacts.length > 0) {
                await prisma.contact.createMany({
                  data: updateClientDto.contacts.map((contact) => ({
                    name: contact.name,
                    email: contact.email,
                    phone: contact.phone,
                    mobile: contact.mobile,
                    notes: contact.notes,
                    clientId: id,
                  })),
                });
              }
            }

            // Atualizar condições de pagamento usando createMany para melhor performance
            if (updateClientDto.creditLimit?.conditions) {
              await prisma.clientPaymentCondition.deleteMany({
                where: { clientId: id },
              });

              if (updateClientDto.creditLimit.conditions.length > 0) {
                await prisma.clientPaymentCondition.createMany({
                  data: updateClientDto.creditLimit.conditions.map(
                    (condition) => ({
                      clientId: id,
                      paymentConditionId: condition.id,
                      isActive: condition.isActive,
                    }),
                  ),
                });
              }
            }

            return { id };
          },
          {
            timeout: 10000, // Aumenta timeout para 10 segundos
          },
        )
        .then(() => this.findOne(id)); // Move findOne para fora da transação
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

  async toggleClientStatus(id: string, sellerId: string) {
    const client = await this.prisma.client.findUnique({
      where: { id },
      include: {
        address: true,
      },
    });

    if (!client) {
      throw new NotFoundException('Cliente não encontrado');
    }

    let newStatus: ClientStatus;

    if (client.status === 'INACTIVE') {
      // Se está INACTIVE, ao ativar determina o status baseado nos dados
      const cpfCnpj = client.cpf || client.cnpj;
      const hasAddress = client.address && client.address.length > 0;
      const phone = client.phone;
      const mobile = client.mobile;

      const calculatedStatus = this.determineClientStatus(
        client.name,
        cpfCnpj,
        hasAddress ? [{}] : undefined,
        phone,
        mobile,
      );

      // Se o status calculado for ACTIVE, precisa verificar permissão
      if (calculatedStatus === 'ACTIVE') {
        // Verificar se tem permissão para aprovar
        let canApprove = false;

        const seller = await this.prisma.sellerProfile.findFirst({
          where: {
            employees: {
              some: {
                user: {
                  id: sellerId,
                },
              },
            },
          },
          select: {
            id: true,
            canApprovePreRegistration: true,
          },
        });

        // Se não encontrou um seller profile, verificar se é admin
        if (!seller) {
          const user = await this.prisma.user.findUnique({
            where: {
              id: sellerId,
            },
            select: {
              employee: {
                select: {
                  role: {
                    select: {
                      name: true,
                    },
                  },
                },
              },
            },
          });

          // Se for Admin, pode aprovar
          if (user?.employee?.[0]?.role?.name === 'Admin') {
            canApprove = true;
          }
        } else if (seller.canApprovePreRegistration) {
          // Se encontrou o seller e ele tem permissão
          canApprove = true;
        }

        // Se tem permissão, usa ACTIVE, senão usa PROSPECT
        if (canApprove) {
          newStatus = 'ACTIVE';
        } else {
          newStatus = 'PROSPECT';
          console.log(
            `Usuário ${sellerId} não tem permissão para ativar cliente como ACTIVE. Status definido como PROSPECT.`,
          );
        }
      } else {
        // Se o status calculado for PROSPECT, usa PROSPECT
        newStatus = calculatedStatus;
      }
    } else {
      // Se está ACTIVE ou PROSPECT, muda para INACTIVE (não precisa permissão especial)
      newStatus = 'INACTIVE';
    }

    await this.prisma.client.update({
      where: { id },
      data: { status: newStatus },
    });

    return this.findOne(id);
  }

  remove(id: string) {
    return this.prisma.client.delete({
      where: { id: id },
    });
  }

  async createClientsFromCsv(filePath: string, companyId: string) {
    const clients: CreateClientDto[] = [];

    // Buscar limites de crédito padrão
    const companyCreditLimits = await this.prisma.creditLimitDefault.findMany({
      where: {
        companyId: companyId,
        type: 'COMPANY',
      },
      include: {
        paymentConditions: true,
      },
    });
    const personCreditLimits = await this.prisma.creditLimitDefault.findMany({
      where: {
        companyId: companyId,
        type: 'PERSON',
      },
      include: {
        paymentConditions: true,
      },
    });

    return new Promise<void>((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(fastCsv.parse({ headers: true, skipRows: 1 })) // skip header and expect dynamic columns
        .on('data', (row) => {
          const clientDto: CreateClientDto = {
            status: row.status || null,
            type: row.type || null,
            general: {
              name: row.name || null,
              email: row.email || null,
              phone: row.phone || null,
              mobile: row.mobile || null,
              categoryId: row.categoryId || undefined,
              cpf: row.cpf || null,
              rg: row.rg || null,
              cnpj: row.cnpj || null,
              activity: row.activity || null,
              corporateName: row.corporateName || null,
              notes: row.notes || null,
            },
            companyId: row.companyId || null,
            creditLimit: {
              minValue: null,
              maxValue: null,
              blockClient: row.blockClient === 'true',
              conditions: [],
            },
            addresses: row.zipcode
              ? [
                  {
                    type: 'MAIN',
                    zipcode: row.zipcode || null,
                    state: row.state || null,
                    city: row.city || null,
                    neighborhood: row.neighborhood || null,
                    street: row.street || null,
                    number: row.number || null,
                    complement: row.complement || null,
                  },
                ]
              : null, // se endereço estiver faltando, coloca null
            contacts: row.contactName
              ? [
                  {
                    name: row.contactName || null,
                    email: row.contactEmail || null,
                    phone: row.contactPhone || null,
                    mobile: row.contactMobile || null,
                    notes: row.contactNotes || null,
                  },
                ]
              : [],
          };

          // Define os limites de crédito e condições padrão com base no tipo do cliente
          const creditDefaults =
            row.type === 'COMPANY'
              ? companyCreditLimits[0]
              : personCreditLimits[0];

          if (creditDefaults) {
            clientDto.creditLimit.minValue = creditDefaults.minValue;
            clientDto.creditLimit.maxValue = creditDefaults.maxValue;
            clientDto.creditLimit.conditions =
              creditDefaults.paymentConditions.map((condition) => ({
                id: condition.paymentConditionId,
                isActive: condition.isActive,
              }));
          }

          clients.push(clientDto);
        })
        .on('end', async () => {
          try {
            for (const clientDto of clients) {
              const client = await this.prisma.client.create({
                data: {
                  type: clientDto.type,
                  name: clientDto.general.name,
                  email: clientDto.general.email,
                  phone: clientDto.general.phone,
                  mobile: clientDto.general.mobile,
                  companyId: companyId,
                  categoryId: clientDto.general.categoryId,
                  cpf: clientDto.general.cpf,
                  rg: clientDto.general.rg,
                  cnpj: clientDto.general.cnpj,
                  activity: clientDto.general.activity,
                  corporateName: clientDto.general.corporateName,
                  notes: clientDto.general.notes,
                  maxValue: clientDto.creditLimit.maxValue,
                  minValue: clientDto.creditLimit.minValue,
                },
              });

              // Salva endereço (opcional)
              if (clientDto.addresses) {
                const address = clientDto.addresses[0];
                if (address) {
                  await this.prisma.address.create({
                    data: {
                      type: address.type,
                      zipcode: address.zipcode,
                      state: address.state,
                      city: address.city,
                      neighborhood: address.neighborhood,
                      street: address.street,
                      number: address.number,
                      complement: address.complement,
                      ownerId: client.id,
                      ownerType: 'CLIENT',
                    },
                  });
                }
              }

              // Salva contato (opcional)
              if (clientDto.contacts?.length > 0) {
                const contact = clientDto.contacts[0];
                await this.prisma.contact.create({
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

              // Salva condições de pagamento
              for (const condition of clientDto.creditLimit.conditions) {
                await this.prisma.clientPaymentCondition.create({
                  data: {
                    clientId: client.id,
                    paymentConditionId: condition.id,
                    isActive: condition.isActive,
                  },
                });
              }
            }
            resolve();
          } catch (error) {
            console.error('Erro ao salvar clientes:', error);
            reject(error);
          }
        })
        .on('error', (error) => {
          console.error('Erro ao processar CSV:', error);
          reject(error);
        });
    });
  }

  async createClientsFromCsvV2(filePath: string, companyId: string) {
    const clients: CreateClientDto[] = [];

    // Buscar limites de crédito padrão
    const companyCreditLimits = await this.prisma.creditLimitDefault.findMany({
      where: {
        companyId: companyId,
        type: 'COMPANY',
      },
      include: {
        paymentConditions: true,
      },
    });
    const personCreditLimits = await this.prisma.creditLimitDefault.findMany({
      where: {
        companyId: companyId,
        type: 'PERSON',
      },
      include: {
        paymentConditions: true,
      },
    });

    return new Promise<void>((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(fastCsv.parse({ headers: true, delimiter: ';' }))
        .on('data', (row) => {
          // Mapear o tipo do cliente (J = COMPANY, F = PERSON)
          const clientType = row.Tipo === 'J' ? 'COMPANY' : 'PERSON';

          // Mapear o status (Ativo = ACTIVE, Inativo = INACTIVE)
          const status = row.Status === 'Ativo' ? 'ACTIVE' : 'INACTIVE';

          const clientDto: CreateClientDto = {
            status: status,
            type: clientType,
            general: {
              name: row.Nome || null,
              email: row.Email || null,
              phone: row.Telefone || null,
              mobile: row.Celular || null,
              categoryId: undefined, // Não existe no CSV v2
              cpf: row.CPF || null,
              rg: row.RG || null,
              cnpj: row.CNPJ || null,
              activity: row.Atividade || null,
              corporateName: row.RazaoSocial || null,
              notes: row.Observacao || null,
            },
            companyId: companyId,
            creditLimit: {
              minValue: null,
              maxValue: null,
              blockClient: false,
              conditions: [],
            },
            addresses: row.CEP
              ? [
                  {
                    type: 'MAIN',
                    zipcode: row.CEP || null,
                    state: row.Uf || null,
                    city: row.Cidade || null,
                    neighborhood: row.Bairro || null,
                    street: row.Rua || null,
                    number: row.Numero || null,
                    complement: row.Complemento || null,
                  },
                ]
              : null,
            contacts: [], // Não existe contatos no CSV v2
          };

          // Define os limites de crédito e condições padrão com base no tipo do cliente
          const creditDefaults =
            clientType === 'COMPANY'
              ? companyCreditLimits[0]
              : personCreditLimits[0];

          if (creditDefaults) {
            clientDto.creditLimit.minValue = creditDefaults.minValue;
            clientDto.creditLimit.maxValue = creditDefaults.maxValue;
            clientDto.creditLimit.conditions =
              creditDefaults.paymentConditions.map((condition) => ({
                id: condition.paymentConditionId,
                isActive: condition.isActive,
              }));
          }

          clients.push(clientDto);
        })
        .on('end', async () => {
          try {
            for (const clientDto of clients) {
              const client = await this.prisma.client.create({
                data: {
                  type: clientDto.type,
                  name: clientDto.general.name,
                  email: clientDto.general.email,
                  phone: clientDto.general.phone,
                  mobile: clientDto.general.mobile,
                  companyId: companyId,
                  categoryId: clientDto.general.categoryId,
                  cpf: clientDto.general.cpf,
                  rg: clientDto.general.rg,
                  cnpj: clientDto.general.cnpj,
                  activity: clientDto.general.activity,
                  corporateName: clientDto.general.corporateName,
                  notes: clientDto.general.notes,
                  maxValue: clientDto.creditLimit.maxValue,
                  minValue: clientDto.creditLimit.minValue,
                  status: clientDto.status,
                },
              });

              // Salva endereço (opcional)
              if (clientDto.addresses) {
                const address = clientDto.addresses[0];
                if (address) {
                  await this.prisma.address.create({
                    data: {
                      type: address.type,
                      zipcode: address.zipcode,
                      state: address.state,
                      city: address.city,
                      neighborhood: address.neighborhood,
                      street: address.street,
                      number: address.number,
                      complement: address.complement,
                      ownerId: client.id,
                      ownerType: 'CLIENT',
                    },
                  });
                }
              }

              // Salva condições de pagamento
              for (const condition of clientDto.creditLimit.conditions) {
                await this.prisma.clientPaymentCondition.create({
                  data: {
                    clientId: client.id,
                    paymentConditionId: condition.id,
                    isActive: condition.isActive,
                  },
                });
              }
            }
            resolve();
          } catch (error) {
            console.error('Erro ao salvar clientes:', error);
            reject(error);
          }
        })
        .on('error', (error) => {
          console.error('Erro ao processar CSV:', error);
          reject(error);
        });
    });
  }
}
