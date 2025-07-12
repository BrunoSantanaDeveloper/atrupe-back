import { Injectable } from '@nestjs/common';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { AddressService } from '../address/address.service';
import { PlugService } from '../../svc/plug/plug.service';
import {
  ClientKind,
  ClientStatus,
  Company,
  PaymentConditionCostType,
  Prisma,
  ReasonType,
  RecurringType,
  CategoryKind,
} from '@prisma/client';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';
import { ClientService } from '../client/client.service';
import { SupplierService } from '../supplier/supplier.service';
import { BASE_ROLES } from 'src/seeds/roles-base';
import { BASE_PAYMENT_CONDITIONS } from 'src/seeds/payment-conditions-base';
import { BASE_NATURES } from 'src/seeds/natures-base';
import { BASE_SCHEDULED_EXPENSES } from 'src/seeds/scheduled-expenses-base';
import {
  BASE_REASONS,
  BASE_STATUS_QUOTATIONS,
} from 'src/seeds/reasons-status-base';
import { BASE_PRODUCTS_CATEGORIES } from 'src/seeds/products-categories';
import { CreateSalaryControlDto } from '../financial/salaries/dto/create-salary-control.dto';

@Injectable()
export class CompanyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly addressService: AddressService,
    private readonly plugService: PlugService,
    private readonly clientService: ClientService,
    private readonly supplierService: SupplierService,
  ) {}
  async createFirstAccess(email: string, companyId: string) {
    try {
      console.log('Starting createFirstAccess process for email:', email);

      return await this.prisma.$transaction(
        async (tx) => {
          try {
            console.log('Finding user with email:', email);
            const user = await tx.user.findFirst({
              where: {
                email: email,
              },
            });

            if (!user) {
              console.error('User not found for email:', email);
              throw new Error('User not found');
            }
            console.log('User found:', user.id);

            console.log('Finding administration sector');
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
            console.log('Administration sector found:', sector.id);

            console.log('Creating administrator role');
            const role = await tx.role.create({
              data: {
                name: 'Admin',
                companyId: companyId,
                isAdmin: true,
                sectorId: sector.id,
              },
            });
            console.log('Administrator role created:', role.id);

            console.log('Creating seller profile for administrator');
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
            console.log(
              'Administrator seller profile created:',
              sellerProfile.id,
            );

            console.log('Creating employee record');
            await tx.employee.create({
              data: {
                name: user.name,
                companyId: companyId,
                roleId: role.id,
                userId: user.id,
                sectorId: sector.id,
                sellerProfileId: sellerProfile.id,
              },
            });
            console.log('Employee record created successfully');

            console.log('createFirstAccess process completed successfully');
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

  // async createSeedAccountPlans(companyId: string) {
  //   try {
  //     console.log('Starting createSeedAccountPlans for company:', companyId);

  //     const company = await this.prisma.company.findUnique({
  //       where: {
  //         id: companyId,
  //       },
  //     });

  //     if (!company) {
  //       console.error('Company not found:', companyId);
  //       throw new Error('Company not found');
  //     }
  //     console.log('Target company found:', company.name);

  //     const MODEL_COMPANY_ID = '2a190fe8-e7af-4d75-8673-494dbae0372b';
  //     console.log('Fetching model company data from:', MODEL_COMPANY_ID);

  //     const modelNatures = await this.prisma.nature.findMany({
  //       where: {
  //         companyId: MODEL_COMPANY_ID,
  //       },
  //       include: {
  //         subCategory: true,
  //       },
  //     });

  //     console.log(`Found ${modelNatures.length} natures to clone`);

  //     // Create a map to store old -> new IDs for relationships
  //     const natureIdMap = new Map<string, string>();
  //     const subCategoryIdMap = new Map<string, string>();

  //     // First, create all natures
  //     for (const modelNature of modelNatures) {
  //       console.log('Creating nature:', modelNature.description);
  //       const newNature = await this.prisma.nature.create({
  //         data: {
  //           description: modelNature.description,
  //           level1: modelNature.level1,
  //           level2: modelNature.level2,
  //           code: modelNature.code,
  //           companyId: companyId,
  //           isActive: modelNature.isActive,
  //         },
  //       });
  //       natureIdMap.set(modelNature.id, newNature.id);

  //       // Then create all subcategories for this nature
  //       if (modelNature.subCategory && modelNature.subCategory.length > 0) {
  //         console.log(
  //           `Creating ${modelNature.subCategory.length} subcategories for nature:`,
  //           modelNature.description,
  //         );

  //         for (const modelSubCategory of modelNature.subCategory) {
  //           const newSubCategory = await this.prisma.subCategory.create({
  //             data: {
  //               description: modelSubCategory.description,
  //               code: modelSubCategory.code,
  //               natureId: newNature.id,
  //               companyId: companyId,
  //               isActive: modelSubCategory.isActive,
  //             },
  //           });
  //           subCategoryIdMap.set(modelSubCategory.id, newSubCategory.id);
  //         }
  //       }
  //     }

  //     console.log('Successfully cloned all natures and subcategories');
  //     return {
  //       message: 'Successfully cloned account plans',
  //       naturesCreated: modelNatures.length,
  //     };
  //   } catch (error) {
  //     console.error('Error in createSeedAccountPlans:', error);
  //     throw error;
  //   }
  // }

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

      return company;
    } catch (e) {
      console.error(e);
      throw e;
    }
  }

  async test() {
    const salaries: CreateSalaryControlDto = {
      companyId: '41c48d4a-9e79-461a-8c1e-123080d8cd5f',
      reference: 'Salário',
      type: 'INCREASE',
      amount: 0,
    };
    await this.createSalariesSheets(salaries);
  }

  async createDefaultItems(email: string, companyId: string) {
    await this.createDefaultSectors(companyId);
    await this.createDefaultUnits(companyId);
    await this.createDefaultSaleSeries(companyId);
    await this.createDefaultPaymentMethods(companyId);
    await this.createDefaultProductCategories(companyId);
    await this.createDefaultProducts(companyId);
    await this.createDefaultClientAndSupplier(companyId);
    // await this.createExampleQuotation(companyId);
    await this.applyBaseRolesToCompany(companyId);
    await this.createDefaultSeller(companyId);
    await this.applyBaseCashboxToCompany(companyId);
    await this.applyBasePaymentConditionsToCompany(companyId);
    await this.applyBaseNaturesToCompany(companyId);
    await this.applyBaseScheduledExpensesToCompany(companyId);
    await this.applyReasonsAndStatusQuotationToCompany(companyId);
    const salaries: CreateSalaryControlDto = {
      companyId,
      reference: 'Salário',
      type: 'INCREASE',
      amount: 0,
    };
    const commission: CreateSalaryControlDto = {
      companyId,
      reference: 'Comissão',
      type: 'INCREASE',
      amount: 0,
    };
    await this.createDefaultClientCategories(companyId);
    await this.createFirstAccess(email, companyId);
    await this.createSalariesSheets(salaries);
    await this.createSalariesSheets(commission);
  }

  private async createSalariesSheets(
    createSalaryControlDto: CreateSalaryControlDto,
  ) {
    try {
      // Buscar todos os funcionários ativos da empresa
      const employees = await this.prisma.employee.findMany({
        where: {
          companyId: createSalaryControlDto.companyId,
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

      // Determinar se isSet deve ser true ou false baseado no valor
      const isSet = createSalaryControlDto.amount > 0;

      // Criar salary controls para todos os funcionários
      await Promise.all(
        employees.map(async (employee) => {
          return await this.prisma.salaryControl.create({
            data: {
              reference: createSalaryControlDto.reference,
              amount: createSalaryControlDto.amount,
              date: new Date(),
              companyId: createSalaryControlDto.companyId,
              type: createSalaryControlDto.type,
              employeeId: employee.id,
              isSet: isSet,
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
  private async createExampleQuotation(companyId: string) {
    try {
      console.log('Creating example quotation...');

      // Buscar dados necessários
      const [
        exampleClient,
        adminEmployee,
        quotationSeries,
        bannerProduct,
        placaProduct,
      ] = await Promise.all([
        this.prisma.client.findFirst({
          where: { name: 'Cliente Exemplo', companyId },
        }),
        this.prisma.employee.findFirst({
          where: { companyId, role: { isAdmin: true } },
        }),
        this.prisma.saleSeries.findFirst({
          where: { code: 'V1', companyId },
        }),
        this.prisma.product.findFirst({
          where: { code: 'BAN001', companyId },
        }),
        this.prisma.product.findFirst({
          where: { code: 'PLA001', companyId },
        }),
      ]);

      if (
        !exampleClient ||
        !adminEmployee ||
        !quotationSeries ||
        !bannerProduct ||
        !placaProduct
      ) {
        console.log(
          '⚠️  Alguns dados necessários não foram encontrados para criar orçamento exemplo',
        );
        return;
      }

      // Criar orçamento exemplo
      const exampleQuotation = await this.prisma.quotation.create({
        data: {
          status: 'OPEN',
          quotationNumber: 1,
          companyId: companyId,
          subCompanyId: companyId,
          sellerId: adminEmployee.id,
          clientId: exampleClient.id,
          seriesId: quotationSeries.id,
          description:
            'Este é um orçamento de exemplo criado automaticamente para demonstrar o funcionamento do sistema. Inclui um produto simples e um produto composto.',
          totalValue: 265,
        },
      });

      // Adicionar produtos ao orçamento
      await Promise.all([
        this.prisma.quotationProduct.create({
          data: {
            quotationId: exampleQuotation.id,
            productId: bannerProduct.id,
            quantity: 2,
            description: 'Banner promocional 2x1m',
            totalValue: 70,
            allowEditDescription: true,
            allowEditValues: true,
          },
        }),
        this.prisma.quotationProduct.create({
          data: {
            quotationId: exampleQuotation.id,
            productId: placaProduct.id,
            quantity: 1,
            description: 'Placa de identificação personalizada 30x20cm',
            totalValue: 195,
            allowEditDescription: true,
            allowEditValues: true,
          },
        }),
      ]);

      console.log(`✅ Orçamento exemplo criado: ${exampleQuotation.id}`);
      console.log('   - Total: R$ 265,00');
      console.log('   - Produtos: 1 simples + 1 composto');
    } catch (error) {
      console.error('❌ Erro ao criar orçamento exemplo:', error.message);
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
      cnpj: general?.cnpj.replace(/\D/g, ''),
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
          isAdmin: roleData.isAdmin,
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

    const paymentMethods = await this.prisma.paymentMethod.findMany({
      where: { companyId },
    });

    for (const method of paymentMethods) {
      await this.prisma.bankAccountCashControl.create({
        data: {
          bankAccountId: bankAccount.id,
          cashRegisterId: null,
          paymentMethodId: method.id,
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
      where: { companyId },
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
          isActive: conditionSeed.isActive,
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

    console.log(
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
          isActive: natureSeed.isActive,
          companyId,
        },
      });

      for (const subCategorySeed of natureSeed.subCategories) {
        await this.prisma.subCategory.create({
          data: {
            description: subCategorySeed.description,
            code: subCategorySeed.code,
            isActive: subCategorySeed.isActive,
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
      if (seed.supplier?.name) {
        const existingSupplier = await this.prisma.supplier.findFirst({
          where: {
            companyId,
            name: seed.supplier.name,
          },
        });

        const supplier =
          existingSupplier ??
          (await this.prisma.supplier.create({
            data: {
              name: seed.supplier.name,
              email: seed.supplier.email,
              status: seed.supplier.status as ClientStatus,
              birthdate: seed.supplier.birthdate,
              financialNotes: seed.supplier.financialNotes,
              nickname: seed.supplier.nickname,
              notes: seed.supplier.notes,
              site: seed.supplier.site,
              activity: seed.supplier.activity,
              cnpj: seed.supplier.cnpj,
              corporateName: seed.supplier.corporateName,
              cpf: seed.supplier.cpf,
              mobile: seed.supplier.mobile,
              phone: seed.supplier.phone,
              rg: seed.supplier.rg,
              tradeName: seed.supplier.tradeName,
              type: seed.supplier.type as ClientKind,
              blockClient: seed.supplier.blockClient,
              category: seed.supplier.category,
              maxValue: seed.supplier.maxValue,
              minValue: seed.supplier.minValue,
              companyId,
            },
          }));

        supplierId = supplier.id;
      }

      // Buscar natureza por código
      const nature = seed.nature?.code
        ? await this.prisma.nature.findFirst({
            where: {
              companyId,
              level1: seed.nature.level1,
              code: seed.nature.code,
            },
          })
        : null;

      // Buscar subcategoria por código e natureza
      const subCategory =
        seed.subCategory?.code && nature?.id
          ? await this.prisma.subCategory.findFirst({
              where: {
                companyId,
                code: seed.subCategory.code,
                natureId: nature.id,
              },
            })
          : null;

      // Criar despesa fixa
      await this.prisma.scheduledExpense.create({
        data: {
          description: seed.description,
          amount: seed.amount,
          dueDay: seed.dueDay,
          recurringType: seed.recurringType as RecurringType,
          isActive: seed.isActive,
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
          isActive: true,
          companyId,
        },
      });
    }

    console.log(
      `Motivos de rejeição e status de orçamento criados para empresa ${companyId}`,
    );
  }

  private async createDefaultSectors(companyId: string) {
    const defaultSectors = await this.prisma.defaultSector.findMany();
    const companySectors = defaultSectors.map((sector) => ({
      name: sector.name,
      icon: sector.icon,
      kind: sector.kind,
      isProductionStage: sector.kind === 'PRODUCTION',
      isSystem: sector.kind === 'SYSTEM',
      companyId: companyId,
      defaultSectorId: sector.id,
    }));

    await this.prisma.companySector.createMany({ data: companySectors });
  }

  private async createDefaultUnits(companyId: string) {
    const defaultUnitOfMeasures =
      await this.prisma.defaultUnitOfMeasure.findMany();

    if (defaultUnitOfMeasures.length === 0) {
      // Se não há unidades padrão, criar as básicas
      const basicUnits = [
        { name: 'Unidade', code: 'UN' },
        { name: 'Quilograma', code: 'KG' },
        { name: 'Metro', code: 'MT' },
        { name: 'Litro', code: 'LT' },
      ];

      const companyUnitOfMeasures = basicUnits.map((unit) => ({
        name: unit.name,
        code: unit.code,
        companyId,
      }));

      await this.prisma.companyUnitOfMeasure.createMany({
        data: companyUnitOfMeasures,
      });
    } else {
      // Usar as unidades padrão do seed
      const companyUnitOfMeasures = defaultUnitOfMeasures.map(
        (unitOfMeasure) => ({
          name: unitOfMeasure.name,
          code: unitOfMeasure.code,
          companyId,
          defaultUnitOfMeasureId: unitOfMeasure.id,
          kind: unitOfMeasure.kind,
          variant: unitOfMeasure.variant,
          defaultVariant: unitOfMeasure.defaultVariant,
        }),
      );

      await this.prisma.companyUnitOfMeasure.createMany({
        data: companyUnitOfMeasures,
      });
    }
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
        productionStatus: 'MANAGE_PRODUCTION',
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
        productionStatus: 'MANAGE_PRODUCTION',
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
        productionStatus: 'MANAGE_PRODUCTION',
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

  private async createDefaultPaymentMethods(companyId: string) {
    const paymentMethods = [
      { name: 'Depósito Bancário', description: 'DEP', companyId: companyId },
      { name: 'Dinheiro', description: 'DIN', companyId: companyId },
      { name: 'Link de Pagamento', description: 'LKP', companyId: companyId },
      { name: 'Pix', description: 'PIX', companyId: companyId },
      { name: 'Cartão de Crédito', description: 'CRD', companyId: companyId },
      { name: 'Boleto Bancário', description: 'BOL', companyId: companyId },
      { name: 'Cartão de Débito', description: 'DEB', companyId: companyId },
      { name: 'Cheque', description: 'CHQ', companyId: companyId },
      { name: 'Permuta', description: 'PER', companyId: companyId },
      { name: 'Pagamento Mensal', description: 'PGM', companyId: companyId },
    ];
    await this.prisma.paymentMethod.createMany({
      data: paymentMethods,
    });
  }

  private async createDefaultSeller(companyId: string) {
    await this.prisma.role.findFirst({
      where: {
        companyId: companyId,
        name: 'Vendedor',
      },
    });

    // Criar perfil de vendedor padrão
    await this.prisma.sellerProfile.create({
      data: {
        name: 'Vendedor Padrão',
        companyId: companyId,
        commission: 5, // 5% de comissão padrão
        maxDiscount: 10, // 10% de desconto máximo padrão
        minValue: 0,
        canApprovePreRegistration: false,
        canCancelSale: false,
      },
    });
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
      isActive: true,
      companyId: companyId,
      sectorId: sectors.find((sector) => sector.name === category.sector.name)
        ?.id,
    }));

    await this.prisma.category.createMany({
      data: categories,
    });
  }

  private async createDefaultProducts(companyId: string) {
    const { BASE_PRODUCTS } = await import('../../seeds/products-base');

    // Buscar setores, categorias e unidades de medida necessárias
    const sectors = await this.prisma.companySector.findMany({
      where: { companyId },
    });

    const categories = await this.prisma.category.findMany({
      where: { companyId },
    });

    const units = await this.prisma.companyUnitOfMeasure.findMany({
      where: { companyId },
    });

    for (const productData of BASE_PRODUCTS) {
      // Encontrar setor pelo nome
      const sector = sectors.find((s) => s.name === productData.setorNome);
      if (!sector) {
        console.warn(`Setor não encontrado: ${productData.setorNome}`);
        continue;
      }

      // Encontrar categoria pelo nome
      const category = categories.find(
        (c) => c.name === productData.categoriaNome,
      );
      if (!category) {
        console.warn(`Categoria não encontrada: ${productData.categoriaNome}`);
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
          allowEditDescription: productData.permitirEditarDescricao,
          allowEditValues: productData.permitirEditarValor,
          categoryId: category.id,
          sectorId: sector.id,
          companyId: companyId,
          productionStages:
            productionStages.length > 0 ? productionStages : null,
          isStandard: true,
        },
      });

      // Criar itens do produto
      for (const item of productData.produto) {
        const unitOfMeasure = units.find((u) => u.code === item.unidadeMedida);
        if (!unitOfMeasure) {
          console.warn(
            `Unidade de medida não encontrada: ${item.unidadeMedida}`,
          );
          continue;
        }

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
            unitOfMeasureId: unitOfMeasure.id,
            salePrice: item.precoVenda,
            unitCost: 0,
            ...dimensions,
          },
        });
      }
    }

    console.log(
      `✅ ${BASE_PRODUCTS.length} produtos padrão criados com sucesso!`,
    );
  }

  private async createDefaultClientAndSupplier(companyId: string) {
    // Criar cliente padrão
    console.log('Creating default client...');
    await this.prisma.client.create({
      data: {
        type: 'PERSON',
        status: 'PROSPECT',
        name: 'Cliente Exemplo',
        email: 'cliente.exemplo@email.com',
        phone: '(11) 3333-4444',
        mobile: '(11) 98888-7777',
        cpf: '123.456.789-00',
        rg: '12.345.678-9',
        category: 'Cliente Padrão',
        notes:
          'Este é um cliente de exemplo criado automaticamente para demonstração. Você pode editá-lo ou excluí-lo conforme necessário.',
        companyId: companyId,
        minValue: 0,
        maxValue: 1000,
        blockClient: false,
      },
    });

    // Criar fornecedor padrão
    console.log('Creating default supplier...');
    await this.prisma.supplier.create({
      data: {
        type: 'COMPANY',
        status: 'ACTIVE',
        name: 'Fornecedor Exemplo LTDA',
        corporateName: 'Fornecedor Exemplo Comércio e Serviços LTDA',
        tradeName: 'Fornecedor Exemplo',
        email: 'fornecedor.exemplo@email.com',
        phone: '(11) 2222-3333',
        mobile: '(11) 97777-6666',
        cnpj: '12.345.678/0001-90',
        activity: 'Comércio e Serviços',
        category: 'Fornecedor Padrão',
        notes:
          'Este é um fornecedor de exemplo criado automaticamente para demonstração. Você pode editá-lo ou excluí-lo conforme necessário.',
        companyId: companyId,
        minValue: 0,
        maxValue: 5000,
        blockClient: false,
      },
    });
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
