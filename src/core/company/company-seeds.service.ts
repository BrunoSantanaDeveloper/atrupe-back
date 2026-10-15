import { Injectable, Logger } from '@nestjs/common';
import {
  ClientKind,
  Prisma,
  RecurringType,
  ReasonType,
  CategoryKind,
} from '@prisma/client';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { BASE_ROLES } from 'src/seeds/roles-base';
import { BASE_PAYMENT_CONDITIONS } from 'src/seeds/payment-conditions-base';
import { BASE_NATURES } from 'src/seeds/natures-base';
import { BASE_SCHEDULED_EXPENSES } from 'src/seeds/scheduled-expenses-base';
import {
  BASE_REASONS,
  BASE_QUOTATION_TAGS,
} from 'src/seeds/reasons-status-base';
import { BASE_PRODUCTS_CATEGORIES } from 'src/seeds/products-categories';
import { BASE_SECTORS } from 'src/seeds/sectors-base';
import { BASE_CFOPS } from 'src/seeds/cfop-base';
import { BASE_OPERATION_NATURES } from 'src/seeds/operation-nature-base';

/**
 * Service responsável pela inicialização de dados padrão para empresas.
 * Extraído de CompanyService para seguir Single Responsibility Principle.
 */
@Injectable()
export class CompanySeedsService {
  private readonly logger = new Logger(CompanySeedsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Configuração dos itens padrão a serem criados para cada empresa.
   * Ordem é importante: itens com dependências vêm depois.
   */
  private defaultItemsConfig = [
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
    {
      name: 'cfops',
      logMessage: 'Creating Base CFOPs...',
      createMethod: (companyId: string) =>
        this.applyBaseCfopsToCompany(companyId),
      checkMethod: async (companyId: string) => {
        const existing = await this.prisma.cfopConfig.findMany({
          where: { companyId },
        });
        return existing.length > 0;
      },
    },
    {
      name: 'operation-natures',
      logMessage: 'Creating Base Operation Natures...',
      createMethod: (companyId: string) =>
        this.applyBaseOperationNaturesToCompany(companyId),
      checkMethod: async (companyId: string) => {
        const existing = await this.prisma.operationNature.findMany({
          where: { companyId },
        });
        return existing.length > 0;
      },
    },
  ];

  /**
   * Cria todos os itens padrão para uma empresa recém-criada.
   */
  async createDefaultItems(email: string, companyId: string) {
    this.logger.log(`creating default items for company ${companyId}...`);

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

  /**
   * Cria apenas os itens faltantes para uma empresa existente.
   */
  async createMissingDefaultItems(companyId: string) {
    this.logger.log(
      `Creating missing default items for company ${companyId}...`,
    );

    try {
      const company = await this.prisma.company.findUnique({
        where: { id: companyId },
      });

      if (!company) {
        throw new Error('Company not found');
      }

      const createdItems = [];

      for (const item of this.defaultItemsConfig) {
        const exists = await item.checkMethod(companyId);
        if (!exists) {
          this.logger.log(
            `Creating missing ${item.name} for company ${companyId}...`,
          );
          await item.createMethod(companyId);
          createdItems.push(item.name);
        }
      }

      this.logger.log(
        `Missing default items creation completed for company ${companyId}`,
      );
      return {
        message: 'Missing default items created successfully',
        companyId: companyId,
        createdItems: createdItems,
      };
    } catch (error) {
      this.logger.error(`Error creating missing default items: ${error}`);
      throw error;
    }
  }

  // =========================================
  // Métodos de criação de seeds específicos
  // =========================================

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
    const unitDefaults = {
      LENGTH: 'MT',
      WEIGHT: 'KG',
      CAPACITY: 'LT',
      DISTANCE: 'KM',
      DURATION: 'HH',
      UNITY: 'UN',
      AREA: 'M2',
    };

    await this.prisma.company.update({
      where: { id: companyId },
      data: { unitDefaults: unitDefaults },
    });
  }

  private async createDefaultSaleSeries(companyId: string) {
    const defaultSeries: Prisma.SaleSeriesCreateManyInput[] = [
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
      await this.prisma.saleSeries.createMany({ data: defaultSeries });
    } catch (error) {
      this.logger.error(`Error creating sale series: ${error}`);
      throw error;
    }
  }

  async applyBasePaymentConditionsToCompany(companyId: string) {
    const paymentMethods = await this.prisma.paymentMethod.findMany({
      where: { isActive: true },
    });

    const createdConditions = [];

    for (const conditionSeed of BASE_PAYMENT_CONDITIONS) {
      const paymentMethod = paymentMethods.find(
        (pm) => pm.code === conditionSeed.paymentMethodCode,
      );

      if (!paymentMethod) {
        this.logger.warn(
          `Método de pagamento com código '${conditionSeed.paymentMethodCode}' não encontrado no sistema`,
        );
        continue;
      }

      const paymentCondition = await this.prisma.paymentCondition.create({
        data: {
          name: conditionSeed.name,
          acceptInstallments: conditionSeed.acceptInstallments,
          costType: conditionSeed.costType as any,
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
      `Condições de pagamento e limites de crédito aplicados com sucesso para empresa: ${companyId}`,
    );
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
        // Empresa nova começa com o controle de caixa desligado (CX-1)
        cashControl: false,
        // O caixa físico da empresa (CX-3): a gaveta se conta
        kind: 'CASH',
        bankId: bank.id,
        companyId,
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
          // A única conta da empresa nova é a padrão de toda forma (CX-2)
          isDefault: true,
        },
      });
    }
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
        this.logger.warn(
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

  private async applyBaseCfopsToCompany(companyId: string) {
    for (const cfop of BASE_CFOPS) {
      await this.prisma.cfopConfig.upsert({
        where: {
          companyId_code: {
            companyId,
            code: cfop.code,
          },
        },
        update: {},
        create: {
          companyId,
          code: cfop.code,
          description: cfop.description,
          type: cfop.type,
          nature: cfop.nature,
          info: cfop.info,
        },
      });
    }
  }

  private async applyBaseOperationNaturesToCompany(companyId: string) {
    for (const nature of BASE_OPERATION_NATURES) {
      const cfopInternal = await this.prisma.cfopConfig.findUnique({
        where: {
          companyId_code: {
            companyId,
            code: nature.cfopInternalCode,
          },
        },
      });

      const cfopExternal = await this.prisma.cfopConfig.findUnique({
        where: {
          companyId_code: {
            companyId,
            code: nature.cfopExternalCode,
          },
        },
      });

      if (!cfopInternal || !cfopExternal) {
        this.logger.warn(
          `CFOPs não encontrados para natureza '${nature.description}' na empresa ${companyId}`,
        );
        continue;
      }

      const existing = await this.prisma.operationNature.findFirst({
        where: {
          companyId,
          description: nature.description,
        },
      });

      if (!existing) {
        await this.prisma.operationNature.create({
          data: {
            companyId,
            description: nature.description,
            type: nature.type,
            finality: nature.finality,
            consumerPresence: nature.consumerPresence,
            info: nature.info,
            cfopInternalId: cfopInternal.id,
            cfopExternalId: cfopExternal.id,
          },
        });
      }
    }
  }

  private async applyBaseScheduledExpensesToCompany(companyId: string) {
    for (const seed of BASE_SCHEDULED_EXPENSES) {
      let supplierId: string | null = null;
      if (seed.supplierName) {
        const existingSupplier = await this.prisma.supplier.findFirst({
          where: {
            companyId,
            name: seed.supplierName,
          },
        });

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

      const nature = await this.prisma.nature.findFirst({
        where: {
          companyId,
          level1: seed.natureLevel1,
          level2: seed.natureLevel2,
          code: seed.natureCode,
        },
      });

      const subCategory = nature?.id
        ? await this.prisma.subCategory.findFirst({
            where: {
              companyId,
              code: seed.subCategoryCode,
              natureId: nature.id,
            },
          })
        : null;

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
    for (const reason of BASE_REASONS) {
      await this.prisma.reasons.create({
        data: {
          reason: reason.reason,
          type: reason.type as ReasonType,
          companyId,
        },
      });
    }

    for (const status of BASE_QUOTATION_TAGS) {
      await this.prisma.quotationTag.create({
        data: {
          title: status.title,
          color: status.color,
          companyId,
        },
      });
    }

    this.logger.log(
      `Motivos de rejeição e tags de orçamento criados para empresa ${companyId}`,
    );
  }

  private async createDefaultProductCategories(companyId: string) {
    const sectors = await this.prisma.companySector.findMany({
      where: { companyId },
    });

    const categories = BASE_PRODUCTS_CATEGORIES.map((category) => ({
      name: category.name,
      kind: CategoryKind.PRODUCT,
      companyId: companyId,
      sectorId: sectors.find((sector) => sector.name === category.sectorName)
        ?.id,
    }));

    await this.prisma.category.createMany({ data: categories });
  }

  private async createDefaultProducts(companyId: string) {
    const { BASE_PRODUCTS } = await import('../../seeds/products-base');

    const sectors = await this.prisma.companySector.findMany({
      where: { companyId },
    });

    const categories = await this.prisma.category.findMany({
      where: { companyId },
    });

    for (const productData of BASE_PRODUCTS) {
      const sector = sectors.find((s) => s.name === productData.setorNome);
      if (!sector) {
        this.logger.warn(`Setor não encontrado: ${productData.setorNome}`);
        continue;
      }

      const category = categories.find(
        (c) => c.name === productData.categoriaNome,
      );
      if (!category) {
        this.logger.warn(
          `Categoria não encontrada: ${productData.categoriaNome}`,
        );
        continue;
      }

      const productionStages = productData.etapasProducao
        .map((etapaName) => {
          const etapaSector = sectors.find((s) => s.name === etapaName);
          return {
            id: etapaSector?.id || '',
            isActive: !!etapaSector,
          };
        })
        .filter((stage) => stage.id);

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

      for (const item of productData.produto) {
        const unitKind = item.tipo;
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
    const clientCategory = await this.prisma.category.findFirst({
      where: {
        companyId: companyId,
        kind: 'CLIENT',
      },
    });

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
          'Este é um cliente de exemplo criado automaticamente para demonstração.',
        companyId: companyId,
        minValue: 0,
        maxValue: 1000,
        blockClient: false,
        status: 'ACTIVE',
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
      { name: 'Comércio', kind: 'CLIENT', companyId },
      { name: 'Indústria', kind: 'CLIENT', companyId },
      { name: 'Serviços', kind: 'CLIENT', companyId },
      {
        name: 'Agências de Publicidade e Marketing',
        kind: 'CLIENT',
        companyId,
      },
      { name: 'Estúdios de Fotografia', kind: 'CLIENT', companyId },
      { name: 'Arquiteto/Decorador', kind: 'CLIENT', companyId },
      { name: 'Saúde', kind: 'CLIENT', companyId },
      { name: 'Terceirizados', kind: 'CLIENT', companyId },
    ];
    await this.prisma.category.createMany({ data: clientCategories });

    const supplierCategories: Prisma.CategoryCreateManyInput[] = [
      { name: 'Serviços Administrativos/Gerais', kind: 'SUPPLIER', companyId },
      { name: 'Suprimentos Gerais', kind: 'SUPPLIER', companyId },
      { name: 'Equipamentos e Manutenção', kind: 'SUPPLIER', companyId },
      { name: 'Serviços Terceirizados', kind: 'SUPPLIER', companyId },
      { name: 'Logística e Transporte', kind: 'SUPPLIER', companyId },
    ];
    await this.prisma.category.createMany({ data: supplierCategories });
  }
}
