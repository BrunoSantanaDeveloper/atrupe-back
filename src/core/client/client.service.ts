import {
  BadRequestException,
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
  async create(createClientDto: CreateClientDto) {
    try {
      const client = await this.prisma.$transaction(async (prisma) => {
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
            corporateName: createClientDto.general.corporateName,
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
        return client;
      });
      return this.findOne(client.id);
    } catch (error) {
      console.error('Error creating client:', error);
      throw error;
    }
  }

  async preRegisterClient(preRegisterClientDto: PreRegisterClientDto) {
    try {
      return await this.prisma.client.create({
        data: {
          type: preRegisterClientDto.type,
          name: preRegisterClientDto.name,
          email: preRegisterClientDto.email,
          phone: preRegisterClientDto.phone,
          mobile: preRegisterClientDto.mobile,
          category: preRegisterClientDto.category,
          status: 'PROSPECT',
          companyId: preRegisterClientDto.companyId,
          rg:
            preRegisterClientDto.type === ClientKind.PERSON
              ? preRegisterClientDto.rg
              : null,
          cpf:
            preRegisterClientDto.type === ClientKind.PERSON
              ? preRegisterClientDto.cpf
              : null,
          cnpj:
            preRegisterClientDto.type === ClientKind.COMPANY
              ? preRegisterClientDto.cnpj
              : null,
          activity:
            preRegisterClientDto.type === ClientKind.COMPANY
              ? preRegisterClientDto.activity
              : null,
          tradeName:
            preRegisterClientDto.type === ClientKind.COMPANY
              ? preRegisterClientDto.tradeName
              : null,
          corporateName:
            preRegisterClientDto.type === ClientKind.COMPANY
              ? preRegisterClientDto.corporateName
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

    // Obter todas as condições de pagamento
    const allPaymentConditions = await this.prisma.paymentCondition.findMany({
      where: {
        companyId: client.companyId,
      },
      include: {
        paymentMethod: true,
      },
    });

    // Agrupar condições de pagamento por método de pagamento
    const paymentMethodsMap = new Map();

    // Rastrear condições de pagamento associadas
    const associatedConditionIds = new Set(
      client.paymentConditions.map((pc) => pc.paymentCondition.id),
    );

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

    // Adicionar condições de pagamento não associadas
    allPaymentConditions.forEach((condition) => {
      if (!associatedConditionIds.has(condition.id)) {
        const method = condition.paymentMethod;
        if (!paymentMethodsMap.has(method.id)) {
          paymentMethodsMap.set(method.id, {
            id: method.id,
            name: method.name,
            conditions: [],
          });
        }
        paymentMethodsMap.get(method.id).conditions.push({
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
            status: updateClientDto.status,
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
            type: row.type || null,
            general: {
              name: row.name || null,
              email: row.email || null,
              phone: row.phone || null,
              mobile: row.mobile || null,
              category: row.category || null,
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
                  category: clientDto.general.category,
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
}
