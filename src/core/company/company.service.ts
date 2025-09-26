import { Injectable } from '@nestjs/common';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { PlugService } from '../../svc/plug/plug.service';
import {
  ClientKind,
  Company,
  PaymentConditionCostType,
  Prisma,
  ReasonType,
  RecurringType,
  CategoryKind,
} from '@prisma/client';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';
import { BASE_ROLES } from 'src/seeds/roles-base';
import { BASE_PAYMENT_CONDITIONS } from 'src/seeds/payment-conditions-base';
import { BASE_NATURES } from 'src/seeds/natures-base';
import { BASE_SCHEDULED_EXPENSES } from 'src/seeds/scheduled-expenses-base';
import {
  BASE_REASONS,
  BASE_STATUS_QUOTATIONS,
} from 'src/seeds/reasons-status-base';
import { BASE_PRODUCTS_CATEGORIES } from 'src/seeds/products-categories';
import { BASE_SECTORS } from 'src/seeds/sectors-base';
import { CreatePayrollSetupDto } from '../financial/salaries/dto/create-payroll-setup.dto';
import { Logger } from '@nestjs/common';

@Injectable()
export class CompanyService {
  private readonly logger = new Logger(CompanyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly plugService: PlugService,
  ) {}
  async createFirstAccess(email: string, companyId: string) {
    try {
      this.logger.log('Starting createFirstAccess process for email:', email);

      return await this.prisma.$transaction(
        async (tx) => {
          try {
            this.logger.log('Finding user with email:', email);
            const user = await tx.user.findFirst({
              where: {
                email: email,
              },
            });

            if (!user) {
              console.error('User not found for email:', email);
              throw new Error('User not found');
            }
            this.logger.log('User found:', user.id);

            this.logger.log('Finding administration sector');
            const sector = await tx.companySector.findFirst({
              where: {
                name: 'Administração',
                companyId: companyId,
              },
            });

            if (!sector) {
              console.error(
                'Administration sector not found for company:',
                companyId,
              );
              throw new Error('Sector not found');
            }
            this.logger.log('Administration sector found:', sector.id);

            this.logger.log('Creating administrator role');
            const role = await tx.role.create({
              data: {
                name: 'Admin',
                companyId: companyId,
                isAdmin: true,
                sectorId: sector.id,
              },
            });
            this.logger.log('Administrator role created:', role.id);

            this.logger.log('Creating seller profile for administrator');
            const sellerProfile = await tx.sellerProfile.create({
              data: {
                name: 'Admin',
                companyId: companyId,
                commission: 0,
                maxDiscount: 100,
                minValue: 0,
                canApprovePreRegistration: true,
                canCancelSale: true,
              },
            });
            this.logger.log(
              'Administrator seller profile created:',
              sellerProfile.id,
            );

            this.logger.log('Creating employee record');
            const employee = await tx.employee.create({
              data: {
                name: user.name,
                companyId: companyId,
                roleId: role.id,
                userId: user.id,
                sectorId: sector.id,
                sellerProfileId: sellerProfile.id,
              },
            });
            this.logger.log('Employee record created successfully');

            // Aplicar templates de salário ao colaborador admin
            this.logger.log('Applying salary templates to admin employee');
            const templates = await tx.payrollTemplate.findMany({
              where: { companyId: companyId },
            });

            if (templates.length > 0) {
              await Promise.all(
                templates.map(async (template) => {
                  await tx.payrollSetup.create({
                    data: {
                      name: template.name,
                      type: template.type,
                      amount: template.defaultAmount,
                      isSet: true,
                      company: {
                        connect: { id: companyId },
                      },
                      employee: {
                        connect: { id: employee.id },
                      },
                      payrollTemplate: {
                        connect: { id: template.id },
                      },
                    },
                  });
                }),
              );
              this.logger.log(
                `Applied ${templates.length} salary templates to admin employee`,
              );
            }

            this.logger.log('createFirstAccess process completed successfully');
            return 'success';
          } catch (error) {
            console.error('Error in transaction:', error);
            throw error;
          }
        },
        {
          timeout: 30000,
        },
      );
    } catch (error) {
      console.error('Error in createFirstAccess:', error);
      throw error;
    }
  }

  async createMainCompany(email: string, createCompanyDto: CreateCompanyDto) {
    try {
      const { general, address, personalization, socialNetworks } =
        createCompanyDto;

      const company = await this.prisma.$transaction(async (tx) => {
        const company = await tx.company.create({
          data: {
            name: general.name,
            legalName: general.legalName,
            cnpj: general.cnpj.replace(/\D/g, ''),
            email: general.email,
            phone: general.phone,
            mobile: general.mobile,
            municipalRegistration: general.municipalRegistration,
            siteUrl: general.siteUrl,
            // Personalization fields
            logoUrl: personalization?.logoUrl,
            favIconUrl: personalization?.favIconUrl,
            textBeforeItems: 'Segue abaixo conforme sua solicitação:',
            textAfterItems:
              '1) Crédito e condição de pagamento sujeito à aprovação;\n2) Impressos c/ alta exigência colorimétrica exige-se prova de cor;\n3) Não nos responsabilizamos por características e especificações dos projetos gráficos fornecidos pelo cliente;\n4) Prazo de entrega são previsões que poderão se alterar e modificar de acordo com o andamento do processo produtivo;\n5) Não aceitamos cancelamentos de pedidos após iniciado o processo de produção;',
            // Social networks fields
            instagram: socialNetworks?.instagram,
            facebook: socialNetworks?.facebook,
            linkedin: socialNetworks?.linkedin,
            trialEndsAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
            // Create related address
            address: address
              ? {
                  create: {
                    street: address.street,
                    number: address.number,
                    complement: address.complement,
                    neighborhood: address.neighborhood,
                    city: address.city,
                    state: address.state,
                    zipcode: address.zipcode,
                    ownerType: 'COMPANY',
                  },
                }
              : undefined,
          },
          include: {
            address: true,
          },
        });
        return company;
      });

      await this.createDefaultItems(email, company.id);
      this.logger.log('Default items created successfully');

      return company;
    } catch (e) {
      console.error(e);
      throw e;
    }
  }

  private defaultItemsConfig = [
    // 1. Setores (base para categorias e produtos)
    {
      name: 'sectors',
      logMessage: 'Creating Default sectors...',
      createMethod: (companyId: string) => this.createDefaultSectors(companyId),
      checkMethod: async (companyId: string) => {
        const existing = await this.prisma.companySector.findMany({
          where: { companyId },
        });
        return existing.length > 0;
      },
    },
    // 2. Unidades de medida (independente)
    {
      name: 'units',
      logMessage: 'Creating Units of measure...',
      createMethod: (companyId: string) => this.createDefaultUnits(companyId),
      checkMethod: async (companyId: string) => {
        const company = await this.prisma.company.findUnique({
          where: { id: companyId },
        });
        return company?.unitDefaults !== null;
      },
    },
    // 3. Séries de venda (independente)
    {
      name: 'sale-series',
      logMessage: 'Creating Sale series...',
      createMethod: (companyId: string) =>
        this.createDefaultSaleSeries(companyId),
      checkMethod: async (companyId: string) => {
        const existing = await this.prisma.saleSeries.findMany({
          where: { companyId },
        });
        return existing.length > 0;
      },
    },
    // 4. Condições de pagamento (depende de métodos de pagamento)
    {
      name: 'payment-conditions',
      logMessage: 'Creating Payment conditions...',
      createMethod: (companyId: string) =>
        this.applyBasePaymentConditionsToCompany(companyId),
      checkMethod: async (companyId: string) => {
        const existing = await this.prisma.paymentCondition.findMany({
          where: { companyId },
        });
        return existing.length > 0;
      },
    },
    // 5. Caixa (depende de condições de pagamento)
    {
      name: 'cashbox',
      logMessage: 'Creating Cashbox...',
      createMethod: (companyId: string) =>
        this.applyBaseCashboxToCompany(companyId),
      checkMethod: async (companyId: string) => {
        const existing = await this.prisma.bankAccount.findFirst({
          where: { companyId, name: 'Caixa Empresa' },
        });
        return existing !== null;
      },
    },
    // 6. Naturezas (independente)
    {
      name: 'natures',
      logMessage: 'Creating Base natures...',
      createMethod: (companyId: string) =>
        this.applyBaseNaturesToCompany(companyId),
      checkMethod: async (companyId: string) => {
        const existing = await this.prisma.nature.findMany({
          where: { companyId },
        });
        return existing.length > 0;
      },
    },
    // 7. Roles/Cargos (depende de setores)
    {
      name: 'roles',
      logMessage: 'Creating Base roles...',
      createMethod: (companyId: string) =>
        this.applyBaseRolesToCompany(companyId),
      checkMethod: async (companyId: string) => {
        const existing = await this.prisma.role.findMany({
          where: { companyId, name: { not: 'Admin' } },
        });
        return existing.length > 0;
      },
    },
    // 8. Categorias de produto (depende de setores)
    {
      name: 'product-categories',
      logMessage: 'Creating Product categories...',
      createMethod: (companyId: string) =>
        this.createDefaultProductCategories(companyId),
      checkMethod: async (companyId: string) => {
        const existing = await this.prisma.category.findMany({
          where: { companyId, kind: 'PRODUCT' },
        });
        return existing.length > 0;
      },
    },
    // 9. Produtos (depende de setores e categorias de produto)
    {
      name: 'products',
      logMessage: 'Creating Products...',
      createMethod: (companyId: string) =>
        this.createDefaultProducts(companyId),
      checkMethod: async (companyId: string) => {
        const existing = await this.prisma.product.findMany({
          where: { companyId },
        });
        return existing.length > 0;
      },
    },
    // 10. Categorias de cliente/fornecedor (independente)
    {
      name: 'client-categories',
      logMessage: 'Creating Client categories...',
      createMethod: (companyId: string) =>
        this.createDefaultClientCategories(companyId),
      checkMethod: async (companyId: string) => {
        const existing = await this.prisma.category.findMany({
          where: { companyId, kind: { in: ['CLIENT', 'SUPPLIER'] } },
        });
        return existing.length > 0;
      },
    },
    // 11. Cliente (depende de categorias de cliente)
    {
      name: 'client',
      logMessage: 'Creating Client...',
      createMethod: (companyId: string) => this.createDefaultClient(companyId),
      checkMethod: async (companyId: string) => {
        const clients = await this.prisma.client.findMany({
          where: { companyId },
        });
        return clients.length > 0;
      },
    },
    // 12. Despesas programadas (independente, mas pode depender de naturezas)
    {
      name: 'scheduled-expenses',
      logMessage: 'Creating Scheduled expenses...',
      createMethod: (companyId: string) =>
        this.applyBaseScheduledExpensesToCompany(companyId),
      checkMethod: async (companyId: string) => {
        const existing = await this.prisma.scheduledExpense.findMany({
          where: { companyId },
        });
        return existing.length > 0;
      },
    },
    // 13. Motivos e status (independente)
    {
      name: 'reasons-status',
      logMessage: 'Creating Reasons and status...',
      createMethod: (companyId: string) =>
        this.applyReasonsAndStatusQuotationToCompany(companyId),
      checkMethod: async (companyId: string) => {
        const existing = await this.prisma.reasons.findMany({
          where: { companyId },
        });
        return existing.length > 0;
      },
    },
    // 14. Template base de salário
    {
      name: 'base-salary-template',
      logMessage: 'Creating base salary template...',
      createMethod: (companyId: string) =>
        this.createBaseSalaryTemplate(companyId),
      checkMethod: async (companyId: string) => {
        const existing = await this.prisma.payrollTemplate.findFirst({
          where: {
            companyId,
            name: 'Salário',
            type: 'INCREASE',
          },
        });
        return existing !== null;
      },
    },
  ];

  async createDefaultItems(email: string, companyId: string) {
    this.logger.log('creating default items for company', companyId);

    for (const item of this.defaultItemsConfig) {
      const exists = await item.checkMethod(companyId);
      if (!exists) {
        this.logger.log(item.logMessage);
        await item.createMethod(companyId);
      } else {
        this.logger.log(
          `${item.name} already exists for company ${companyId}, skipping...`,
        );
      }
    }
  }

  private async createSalariesSheets(
    createPayrollSetupDto: CreatePayrollSetupDto,
  ) {
    try {
      // Buscar todos os funcionários ativos da empresa
      const employees = await this.prisma.employee.findMany({
        where: {
          companyId: createPayrollSetupDto.companyId,
        },
        select: {
          id: true,
          name: true,
        },
      });
      console.log(employees);
      if (employees.length === 0) {
        return 'no employees';
      }

      // Criar payroll setups para todos os funcionários
      await Promise.all(
        employees.map(async (employee) => {
          return await this.prisma.payrollSetup.create({
            data: {
              name: createPayrollSetupDto.name,
              amount: createPayrollSetupDto.amount,
              type: createPayrollSetupDto.type,
              isSet: createPayrollSetupDto.isSet ?? true,
              company: {
                connect: { id: createPayrollSetupDto.companyId },
              },
              employee: {
                connect: { id: employee.id },
              },
            },
            include: {
              employee: {
                select: {
                  id: true,
                  name: true,
                  sector: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                },
              },
            },
          });
        }),
      );

      return;
    } catch (error) {
      console.error(error);
      return;
    }
  }

  async create(
    createCompanyDto: CreateCompanyDto,
    parentCompanyId: string,
  ): Promise<Company> {
    try {
      const company = await this.prisma.company.findUnique({
        where: { id: parentCompanyId },
      });

      if (!company) {
        throw new Error('Company not found');
      }

      const { general, address, personalization, socialNetworks } =
        createCompanyDto;

      return await this.prisma.company.create({
        data: {
          name: general.name,
          legalName: general.legalName,
          cnpj: general.cnpj.replace(/\D/g, ''),
          email: general.email,
          phone: general.phone,
          mobile: general.mobile,
          municipalRegistration: general.municipalRegistration,
          siteUrl: general.siteUrl,
          principalCompanyId: parentCompanyId,
          // Personalization fields
          logoUrl: personalization?.logoUrl,
          favIconUrl: personalization?.favIconUrl,
          textBeforeItems:
            personalization?.textsBeforeItems ||
            'Segue abaixo conforme sua solicitação:',
          textAfterItems:
            personalization?.textsAfterItems ||
            '1) Crédito e condição de pagamento sujeito à aprovação;\n2) Impressos c/ alta exigência colorimétrica exige-se prova de cor;\n3) Não nos responsabilizamos por características e especificações dos projetos gráficos fornecidos pelo cliente;\n4) Prazo de entrega são previsões que poderão se alterar e modificar de acordo com o andamento do processo produtivo;\n5) Não aceitamos cancelamentos de pedidos após iniciado o processo de produção;',
          // Social networks fields
          instagram: socialNetworks?.instagram,
          facebook: socialNetworks?.facebook,
          linkedin: socialNetworks?.linkedin,

          // Create related address
          address: address
            ? {
                create: {
                  street: address.street,
                  number: address.number,
                  complement: address.complement,
                  neighborhood: address.neighborhood,
                  city: address.city,
                  state: address.state,
                  zipcode: address.zipcode,
                  ownerType: 'COMPANY',
                },
              }
            : undefined,
        },
        include: {
          address: true,
        },
      });
    } catch (e) {
      console.error(e);
      throw e;
    }
  }

  async check(cnpj: string) {
    try {
      return await this.plugService.company(cnpj);
    } catch (e) {
      console.error(e);
      throw e;
    }
  }

  async findAll(filter: BaseFilterDTO) {
    const { page = 1, limit = 10, companyId } = filter;
    const [total, companies] = await Promise.all([
      this.prisma.company.count({
        where: {
          OR: [{ id: companyId }, { principalCompanyId: companyId }],
        },
      }),
      this.prisma.company.findMany({
        where: {
          OR: [{ id: companyId }, { principalCompanyId: companyId }],
        },
        include: {
          address: true,
        },
        orderBy: {
          principalCompanyId: 'desc',
        },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
    ]);

    const sortedCompanies = companies.sort((a, b) => {
      if (a.id === companyId) return -1;
      if (b.id === companyId) return 1;
      return 0;
    });

    const formattedCompanies = sortedCompanies.map((company, index) => ({
      id: company.id,
      isActive: company.isActive,
      principal: index === 0,
      general: {
        name: company.name,
        legalName: company.legalName,
        municipalRegistration: company.municipalRegistration,
        cnpj: company.cnpj,
        email: company.email,
        siteUrl: company.siteUrl,
        phone: company.phone,
        mobile: company.mobile,
      },
      address: company.address?.length
        ? {
            zipcode: company.address[0].zipcode,
            state: company.address[0].state,
            city: company.address[0].city,
            neighborhood: company.address[0].neighborhood,
            street: company.address[0].street,
            number: company.address[0].number,
            complement: company.address[0].complement,
          }
        : null,
      personalization: {
        logoUrl: company.logoUrl,
        favIconUrl: company.favIconUrl,
        textsBeforeItems: company.textBeforeItems,
        textsAfterItems: company.textAfterItems,
      },
      socialNetworks: {
        instagram: company.instagram,
        facebook: company.facebook,
        linkedin: company.linkedin,
      },
    }));

    return {
      total,
      lastPage: Math.ceil(total / Number(limit)),
      data: formattedCompanies,
    };
  }

  findOne(id: string) {
    return this.prisma.company.findFirst({ where: { id: id } });
  }

  async update(id: string, updateCompanyDto: UpdateCompanyDto) {
    const { general, address, personalization, socialNetworks } =
      updateCompanyDto;
    const data = {
      name: general?.name,
      legalName: general?.legalName,
      cnpj: general?.cnpj ? general.cnpj.replace(/\D/g, '') : undefined,
      email: general?.email,
      phone: general?.phone,
      mobile: general?.mobile,
      municipalRegistration: general?.municipalRegistration,
      siteUrl: general?.siteUrl,
      // Personalization fields
      logoUrl: personalization?.logoUrl,
      favIconUrl: personalization?.favIconUrl,
      textBeforeItems: personalization?.textsBeforeItems,
      textAfterItems: personalization?.textsAfterItems,
      // Social networks fields
      instagram: socialNetworks?.instagram,
      facebook: socialNetworks?.facebook,
      linkedin: socialNetworks?.linkedin,
    };

    if (updateCompanyDto.isActive !== undefined) {
      data['isActive'] = updateCompanyDto.isActive;
    }

    try {
      // First update the company
      const updatedCompany = await this.prisma.company.update({
        where: { id },
        data: data,
        include: {
          address: true,
        },
      });

      // If address is provided, update or create it
      if (address) {
        if (updatedCompany.address?.length > 0) {
          // Update existing address
          try {
            await this.prisma.address.updateMany({
              where: {
                companyId: id,
                ownerType: 'COMPANY',
              },
              data: {
                street: address.street,
                number: address.number,
                complement: address.complement,
                neighborhood: address.neighborhood,
                city: address.city,
                state: address.state,
                zipcode: address.zipcode,
              },
            });
          } catch (error) {
            console.error(error);
          }
        } else {
          // Create new address
          try {
            await this.prisma.address.create({
              data: {
                street: address.street,
                number: address.number,
                complement: address.complement,
                neighborhood: address.neighborhood,
                city: address.city,
                state: address.state,
                zipcode: address.zipcode,
                ownerType: 'COMPANY',
                companyId: updatedCompany.id,
              },
            });
          } catch (error) {
            console.error(error);
          }
        }
      }

      // Return updated company with address
      return await this.prisma.company.findUnique({
        where: { id },
        include: {
          address: true,
        },
      });
    } catch (e) {
      console.error(e);
      throw e;
    }
  }

  remove(id: string) {
    return this.prisma.company.update({
      where: { id: id },
      data: {
        isActive: false,
      },
    });
  }

  async createMissingDefaultItems(companyId: string) {
    this.logger.log('Creating missing default items for company', companyId);

    try {
      // Verificar se a empresa existe
      const company = await this.prisma.company.findUnique({
        where: { id: companyId },
      });

      if (!company) {
        throw new Error('Company not found');
      }

      const createdItems = [];

      // Usar a mesma configuração de createDefaultItems, mas com verificações
      for (const item of this.defaultItemsConfig) {
        const exists = await item.checkMethod(companyId);
        if (!exists) {
          this.logger.log(
            `Creating missing ${item.name} for company ${companyId}`,
          );
          await item.createMethod(companyId);
          createdItems.push(item.name);
        }
      }

      this.logger.log(
        'Missing default items creation completed for company',
        companyId,
      );
      return {
        message: 'Missing default items created successfully',
        companyId: companyId,
        createdItems: createdItems,
      };
    } catch (error) {
      this.logger.error('Error creating missing default items:', error);
      throw error;
    }
  }

  private async applyBaseRolesToCompany(companyId: string) {
    for (const roleData of BASE_ROLES) {
      const sector = await this.prisma.companySector.findFirst({
        where: {
          companyId,
          name: roleData.sectorName,
        },
        select: { id: true },
      });

      if (!sector) {
        console.warn(
          `Setor '${roleData.sectorName}' não encontrado na empresa ${companyId}. Ignorando role ${roleData.name}`,
        );
        continue;
      }

      await this.prisma.role.create({
        data: {
          name: roleData.name,
          permissions: roleData.permissions,
          companyId,
          sectorId: sector.id,
        },
      });
    }
  }

  async applyBaseCashboxToCompany(companyId: string) {
    const bank = await this.prisma.bank.findFirst({
      where: { code: '000' },
    });
    if (!bank) throw new Error("Banco com código '000' não encontrado");

    const bankAccount = await this.prisma.bankAccount.create({
      data: {
        name: 'Caixa Empresa',
        description: 'Caixa Empresa',
        cashControl: true,
        bankId: bank.id,
        companyId,
      },
    });

    await this.prisma.cashRegister.create({
      data: {
        openingDate: new Date(),
        openingBalance: 0,
        companyId,
        bankAccountId: bankAccount.id,
        status: 'OPEN',
      },
    });

    const paymentConditions = await this.prisma.paymentCondition.findMany({
      where: { companyId },
    });

    for (const condition of paymentConditions) {
      await this.prisma.bankAccountCashControl.create({
        data: {
          bankAccountId: bankAccount.id,
          cashRegisterId: null,
          paymentConditionId: condition.id,
          acceptPayments: true,
          acceptIncomes: true,
          acceptMultipleCashRegisters: false,
          paymentType: 'PAYSOFF',
          incomeType: 'PAYSOFF',
        },
      });
    }
  }

  async applyBasePaymentConditionsToCompany(companyId: string) {
    const paymentMethods = await this.prisma.paymentMethod.findMany({
      where: { isActive: true },
    });

    const createdConditions = [];

    for (const conditionSeed of BASE_PAYMENT_CONDITIONS) {
      const paymentMethod = paymentMethods.find(
        (pm) => pm.name === conditionSeed.paymentMethodName,
      );

      if (!paymentMethod) {
        console.warn(
          `Forma de pagamento '${conditionSeed.paymentMethodName}' não encontrada na empresa ${companyId}`,
        );
        continue;
      }

      const paymentCondition = await this.prisma.paymentCondition.create({
        data: {
          name: conditionSeed.name,
          acceptInstallments: conditionSeed.acceptInstallments,
          costType: conditionSeed.costType as PaymentConditionCostType,
          maxInstallments: conditionSeed.maxInstallments,
          minInstallments: conditionSeed.minInstallments,
          dayInterval: conditionSeed.dayInterval,
          receivingType: conditionSeed.receivingType,
          paymentMethodId: paymentMethod.id,
          companyId,
        },
      });

      createdConditions.push(paymentCondition);
    }

    // Criar os dois limites padrões
    const creditLimitPerson = await this.prisma.creditLimitDefault.create({
      data: {
        companyId,
        type: 'PERSON',
        minValue: 2000,
        maxValue: 200000,
      },
    });

    const creditLimitCompany = await this.prisma.creditLimitDefault.create({
      data: {
        companyId,
        type: 'COMPANY',
        minValue: 5000,
        maxValue: 500000,
      },
    });

    // Associar todas as condições de pagamento aos dois limites
    const creditLimits = [creditLimitPerson, creditLimitCompany];

    for (const creditLimit of creditLimits) {
      for (const condition of createdConditions) {
        await this.prisma.creditLimitPaymentCondition.create({
          data: {
            creditLimitDefaultId: creditLimit.id,
            paymentConditionId: condition.id,
            isActive: false,
          },
        });
      }
    }

    this.logger.log(
      'Condições de pagamento e limites de crédito aplicados com sucesso para empresa:',
      companyId,
    );
  }

  async applyBaseNaturesToCompany(companyId: string) {
    for (const natureSeed of BASE_NATURES) {
      const newNature = await this.prisma.nature.create({
        data: {
          description: natureSeed.description,
          level1: natureSeed.level1,
          level2: natureSeed.level2,
          code: natureSeed.code,
          companyId,
        },
      });

      for (const subCategorySeed of natureSeed.subCategories) {
        await this.prisma.subCategory.create({
          data: {
            description: subCategorySeed.description,
            code: subCategorySeed.code,
            companyId,
            natureId: newNature.id,
          },
        });
      }
    }
  }

  private async applyBaseScheduledExpensesToCompany(companyId: string) {
    for (const seed of BASE_SCHEDULED_EXPENSES) {
      // Buscar ou criar o fornecedor
      let supplierId: string | null = null;
      if (seed.supplierName) {
        const existingSupplier = await this.prisma.supplier.findFirst({
          where: {
            companyId,
            name: seed.supplierName,
          },
        });

        // Buscar categoria do fornecedor baseada no supplierCategory do seed
        let categoryId: string | undefined;
        if (seed.supplierCategory) {
          const category = await this.prisma.category.findFirst({
            where: {
              companyId,
              name: seed.supplierCategory,
              kind: 'SUPPLIER',
            },
          });
          categoryId = category?.id;
        }

        const supplier =
          existingSupplier ??
          (await this.prisma.supplier.create({
            data: {
              name: seed.supplierName,
              email: seed.supplierEmail || '',
              cnpj: seed.supplierCnpj || '',
              corporateName: seed.supplierCorporateName || seed.supplierName,
              phone: seed.supplierPhone || '',
              type: (seed.supplierType as ClientKind) || 'COMPANY',
              blockClient: false,
              notes: '',
              activity: '',
              categoryId: categoryId || '',
              companyId,
            },
          }));

        supplierId = supplier.id;
      }

      // Buscar natureza por código
      const nature = await this.prisma.nature.findFirst({
        where: {
          companyId,
          level1: seed.natureLevel1,
          level2: seed.natureLevel2,
          code: seed.natureCode,
        },
      });

      // Buscar subcategoria por código e natureza
      const subCategory = nature?.id
        ? await this.prisma.subCategory.findFirst({
            where: {
              companyId,
              code: seed.subCategoryCode,
              natureId: nature.id,
            },
          })
        : null;

      // Criar despesa fixa
      await this.prisma.scheduledExpense.create({
        data: {
          description: seed.description,
          amount: seed.amount || 0,
          dueDay: seed.dueDay,
          recurringType: seed.recurringType as RecurringType,
          companyId,
          supplierId,
          categoryId: nature?.id,
          subCategoryId: subCategory?.id,
        },
      });
    }
  }
  private async applyReasonsAndStatusQuotationToCompany(companyId: string) {
    // Criar motivos
    for (const reason of BASE_REASONS) {
      await this.prisma.reasons.create({
        data: {
          reason: reason.reason,
          type: reason.type as ReasonType,
          companyId,
        },
      });
    }

    // Criar status de orçamentos
    for (const status of BASE_STATUS_QUOTATIONS) {
      await this.prisma.statusQuotation.create({
        data: {
          title: status.title,
          color: status.color,
          companyId,
        },
      });
    }

    this.logger.log(
      `Motivos de rejeição e status de orçamento criados para empresa ${companyId}`,
    );
  }

  private async createDefaultSectors(companyId: string) {
    const companySectors = BASE_SECTORS.map((sector) => ({
      name: sector.name,
      icon: sector.icon,
      kind: sector.kind as any,
      isProductionStage: sector.isProductionStage,
      isSystem: sector.isSystem,
      companyId: companyId,
    }));

    await this.prisma.companySector.createMany({ data: companySectors });
    this.logger.log(
      `${BASE_SECTORS.length} setores padrão criados para a empresa`,
    );
  }

  private async createDefaultUnits(companyId: string) {
    // Apenas definir padrões da empresa
    const unitDefaults = {
      LENGTH: 'MT', // Metros (padrão de exibição)
      WEIGHT: 'KG', // Quilogramas (padrão de exibição)
      CAPACITY: 'LT', // Litros (padrão de exibição)
      DISTANCE: 'KM', // Quilômetros (padrão de exibição)
      DURATION: 'HH', // Horas (padrão de exibição)
      UNITY: 'UN', // Unidades (padrão de exibição)
      AREA: 'M2', // Metros quadrados (padrão de exibição)
    };

    await this.prisma.company.update({
      where: { id: companyId },
      data: {
        unitDefaults: unitDefaults,
      },
    });
  }

  private async createDefaultSaleSeries(companyId: string) {
    const deafultSeries: Prisma.SaleSeriesCreateManyInput[] = [
      {
        code: 'T1',
        title: 'Orçamento',
        description: 'Treinamento',
        isTraining: true,
        companyId: companyId,
        proposalValidity: 30,
        deliveryDeadline: 30,
        billing: 'ON_ORDER',
        sendToProduction: 'DIRECT',
        productionStatus: 'PRODUCTION_COMPLETED',
        isDefault: true,
      },
      {
        code: 'V1',
        title: 'Orçamento',
        description: 'Vendas Diversas',
        companyId: companyId,
        proposalValidity: 30,
        deliveryDeadline: 30,
        billing: 'ON_ORDER',
        sendToProduction: 'DIRECT',
        productionStatus: 'PRODUCTION_COMPLETED',
        isDefault: false,
      },
      {
        code: 'SL',
        title: 'Orçamento',
        description: 'Cortesia/Retrabalho',
        companyId: companyId,
        proposalValidity: 30,
        deliveryDeadline: 30,
        billing: 'NO_INVOICE',
        sendToProduction: 'DIRECT',
        productionStatus: 'PRODUCTION_COMPLETED',
        isDefault: false,
      },
    ];

    try {
      await this.prisma.saleSeries.createMany({
        data: deafultSeries,
      });
    } catch (error) {
      console.error(error);
      throw error;
    }
  }

  private async createDefaultProductCategories(companyId: string) {
    const sectors = await this.prisma.companySector.findMany({
      where: {
        companyId: companyId,
      },
    });

    const categories = BASE_PRODUCTS_CATEGORIES.map((category) => ({
      name: category.name,
      kind: CategoryKind.PRODUCT,
      companyId: companyId,
      sectorId: sectors.find((sector) => sector.name === category.sectorName)
        ?.id,
    }));

    await this.prisma.category.createMany({
      data: categories,
    });
  }

  private async createDefaultProducts(companyId: string) {
    const { BASE_PRODUCTS } = await import('../../seeds/products-base');

    // Buscar setores e categorias necessárias
    const sectors = await this.prisma.companySector.findMany({
      where: { companyId },
    });

    const categories = await this.prisma.category.findMany({
      where: { companyId },
    });

    for (const productData of BASE_PRODUCTS) {
      // Encontrar setor pelo nome
      const sector = sectors.find((s) => s.name === productData.setorNome);
      if (!sector) {
        this.logger.warn(`Setor não encontrado: ${productData.setorNome}`);
        continue;
      }

      // Encontrar categoria pelo nome
      const category = categories.find(
        (c) => c.name === productData.categoriaNome,
      );
      if (!category) {
        this.logger.warn(
          `Categoria não encontrada: ${productData.categoriaNome}`,
        );
        continue;
      }

      // Configurar etapas de produção
      const productionStages = productData.etapasProducao
        .map((etapaName) => {
          const etapaSector = sectors.find((s) => s.name === etapaName);
          return {
            id: etapaSector?.id || '',
            isActive: !!etapaSector,
          };
        })
        .filter((stage) => stage.id); // Remove etapas sem setor correspondente

      // Criar produto
      const product = await this.prisma.product.create({
        data: {
          name: productData.nome,
          code: productData.codigo,
          categoryId: category.id,
          sectorId: sector.id,
          companyId: companyId,
          productionStages:
            productionStages.length > 0 ? productionStages : null,
          isStandard: true,
          imageUrl: productData.imageUrl,
          allowEditValues: true,
          allowEditDescription: true,
        },
      });

      // Criar itens do produto
      for (const item of productData.produto) {
        const unitKind = item.tipo;

        // Configurar dimensões baseado na unidade de medida
        const dimensions: any = {};
        if (item.dimensoes) {
          if ('largura' in item.dimensoes && item.dimensoes.largura) {
            dimensions.width = item.dimensoes.largura;
          }
          if ('altura' in item.dimensoes && item.dimensoes.altura) {
            dimensions.height = item.dimensoes.altura;
          }
          if ('duracao' in item.dimensoes && item.dimensoes.duracao) {
            dimensions.duration = item.dimensoes.duracao;
          }
        }

        await this.prisma.productItem.create({
          data: {
            name: item.nome,
            productId: product.id,
            unitKind: unitKind as any,
            salePrice: item.precoVenda || 0,
            unitCost: item.precoUnitario || 0,
            ...dimensions,
          },
        });
      }
    }

    this.logger.log(
      `${BASE_PRODUCTS.length} produtos padrão criados com sucesso!`,
    );
  }

  private async createDefaultClient(companyId: string) {
    // Buscar a primeira categoria de cliente
    const clientCategory = await this.prisma.category.findFirst({
      where: {
        companyId: companyId,
        kind: 'CLIENT',
      },
    });

    // Criar cliente padrão
    this.logger.log('Creating default client...');
    await this.prisma.client.create({
      data: {
        type: 'PERSON',
        name: 'Cliente Exemplo',
        email: 'cliente.exemplo@email.com',
        phone: '(11) 3333-4444',
        mobile: '(11) 98888-7777',
        cpf: '012.345.678-90',
        rg: '12.345.678-9',
        categoryId: clientCategory?.id || '',
        notes:
          'Este é um cliente de exemplo criado automaticamente para demonstração. Você pode editá-lo ou excluí-lo conforme necessário.',
        companyId: companyId,
        minValue: 0,
        maxValue: 1000,
        blockClient: false,
      },
    });
  }

  private async createBaseSalaryTemplate(companyId: string) {
    await this.prisma.payrollTemplate.create({
      data: {
        name: 'Salário',
        type: 'INCREASE',
        defaultAmount: 0,
        companyId,
      },
    });
    this.logger.log(
      'Base salary template "Salário" created for company',
      companyId,
    );
  }

  private async createDefaultClientCategories(companyId: string) {
    const clientCategories: Prisma.CategoryCreateManyInput[] = [
      {
        name: 'Comércio',
        kind: 'CLIENT',
        companyId: companyId,
      },
      {
        name: 'Indústria',
        kind: 'CLIENT',
        companyId: companyId,
      },
      {
        name: 'Serviços',
        kind: 'CLIENT',
        companyId: companyId,
      },
      {
        name: 'Agências de Publicidade e Marketing',
        kind: 'CLIENT',
        companyId: companyId,
      },
      {
        name: 'Estúdios de Fotografia',
        kind: 'CLIENT',
        companyId: companyId,
      },
      {
        name: 'Arquiteto/Decorador',
        kind: 'CLIENT',
        companyId: companyId,
      },
      {
        name: 'Saúde',
        kind: 'CLIENT',
        companyId: companyId,
      },
      {
        name: 'Terceirizados',
        kind: 'CLIENT',
        companyId: companyId,
      },
    ];
    await this.prisma.category.createMany({
      data: clientCategories,
    });

    const supplierCategories: Prisma.CategoryCreateManyInput[] = [
      {
        name: 'Serviços Administrativos/Gerais',
        kind: 'SUPPLIER',
        companyId: companyId,
      },
      {
        name: 'Suprimentos Gerais',
        kind: 'SUPPLIER',
        companyId: companyId,
      },
      {
        name: 'Equipamentos e Manutenção',
        kind: 'SUPPLIER',
        companyId: companyId,
      },
      {
        name: 'Serviços Terceirizados',
        kind: 'SUPPLIER',
        companyId: companyId,
      },
      {
        name: 'Logística e Transporte',
        kind: 'SUPPLIER',
        companyId: companyId,
      },
    ];
    await this.prisma.category.createMany({
      data: supplierCategories,
    });
  }
}
