import { Injectable } from '@nestjs/common';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { AddressService } from '../address/address.service';
import { PlugService } from '../../svc/plug/plug.service';
import { Company, Prisma } from '@prisma/client';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';
import { ClientService } from '../client/client.service';
import { SupplierService } from '../supplier/supplier.service';
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

  async createSeedAccountPlans(companyId: string) {
    try {
      console.log('Starting createSeedAccountPlans for company:', companyId);

      const company = await this.prisma.company.findUnique({
        where: {
          id: companyId,
        },
      });

      if (!company) {
        console.error('Company not found:', companyId);
        throw new Error('Company not found');
      }
      console.log('Target company found:', company.name);

      const MODEL_COMPANY_ID = '2a190fe8-e7af-4d75-8673-494dbae0372b';
      console.log('Fetching model company data from:', MODEL_COMPANY_ID);

      const modelNatures = await this.prisma.nature.findMany({
        where: {
          companyId: MODEL_COMPANY_ID,
        },
        include: {
          subCategory: true,
        },
      });

      console.log(`Found ${modelNatures.length} natures to clone`);

      // Create a map to store old -> new IDs for relationships
      const natureIdMap = new Map<string, string>();
      const subCategoryIdMap = new Map<string, string>();

      // First, create all natures
      for (const modelNature of modelNatures) {
        console.log('Creating nature:', modelNature.description);
        const newNature = await this.prisma.nature.create({
          data: {
            description: modelNature.description,
            level1: modelNature.level1,
            level2: modelNature.level2,
            code: modelNature.code,
            companyId: companyId,
            isActive: modelNature.isActive,
          },
        });
        natureIdMap.set(modelNature.id, newNature.id);

        // Then create all subcategories for this nature
        if (modelNature.subCategory && modelNature.subCategory.length > 0) {
          console.log(
            `Creating ${modelNature.subCategory.length} subcategories for nature:`,
            modelNature.description,
          );

          for (const modelSubCategory of modelNature.subCategory) {
            const newSubCategory = await this.prisma.subCategory.create({
              data: {
                description: modelSubCategory.description,
                code: modelSubCategory.code,
                natureId: newNature.id,
                companyId: companyId,
                isActive: modelSubCategory.isActive,
              },
            });
            subCategoryIdMap.set(modelSubCategory.id, newSubCategory.id);
          }
        }
      }

      console.log('Successfully cloned all natures and subcategories');
      return {
        message: 'Successfully cloned account plans',
        naturesCreated: modelNatures.length,
      };
    } catch (error) {
      console.error('Error in createSeedAccountPlans:', error);
      throw error;
    }
  }

  async createMainCompany(createCompanyDto: CreateCompanyDto) {
    try {
      const { general, address, personalization } = createCompanyDto;

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

      await this.createDefaultItems(company.id);

      // Criar plano de contas padrão (naturezas e subcategorias)
      await this.createSeedAccountPlans(company.id);

      return company;
    } catch (e) {
      console.error(e);
      throw e;
    }
  }

  async createDefaultItems(companyId: string) {
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

    const defaultUnitOfMeasures =
      await this.prisma.defaultUnitOfMeasure.findMany();

    const companyUnitOfMeasures = defaultUnitOfMeasures.map(
      (unitOfMeasure) => ({
        name: unitOfMeasure.name,
        code: unitOfMeasure.code,
        companyId: companyId,
        defaultUnitOfMeasureId: unitOfMeasure.id,
      }),
    );

    await this.prisma.companyUnitOfMeasure.createMany({
      data: companyUnitOfMeasures,
    });

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

    await this.prisma.creditLimitDefault.create({
      data: {
        companyId: companyId,
        type: 'PERSON',
        minValue: 0,
        maxValue: 0,
      },
    });
    await this.prisma.creditLimitDefault.create({
      data: {
        companyId: companyId,
        type: 'COMPANY',
        minValue: 0,
        maxValue: 0,
      },
    });
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

    const sector = await this.prisma.companySector.findFirst({
      where: {
        name: 'Comercial',
        companyId: companyId,
      },
    });

    if (!sector) {
      console.error('Administration sector not found for company:', companyId);
      throw new Error('Sector not found');
    }

    const role = await this.prisma.role.create({
      data: {
        name: 'Vendedor',
        companyId: companyId,
        isAdmin: false,
        sectorId: sector.id,
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

    await this.prisma.category.create({
      data: {
        name: 'Produtos Padrão',
        companyId: companyId,
        sectorId: sector.id,
      },
    });

    // Criar categorias adicionais úteis para comunicação visual e gráfica
    console.log('Creating additional product categories...');
    const additionalCategories = [
      'Impressão Digital',
      'Sinalização',
      'Material Promocional',
      'Adesivos e Etiquetas',
      'Placas e Totens',
      'Banners e Faixas',
      'Cartões e Folders',
      'Materiais Gráficos',
    ];

    for (const categoryName of additionalCategories) {
      await this.prisma.category.create({
        data: {
          name: categoryName,
          kind: 'PRODUCT',
          isActive: true,
          companyId: companyId,
          sectorId: sector.id,
        },
      });
    }

    console.log('Vendedor role created:', role.id);
    console.log('Default seller profile created successfully');
    console.log(
      `Created ${additionalCategories.length + 1} product categories successfully`,
    );

    // Criar produtos padrão
    console.log('Creating default products...');

    // Buscar categoria "Produtos Padrão" e unidades de medida necessárias
    const defaultCategory = await this.prisma.category.findFirst({
      where: {
        name: 'Produtos Padrão',
        companyId: companyId,
      },
    });

    const m2Unit = await this.prisma.companyUnitOfMeasure.findFirst({
      where: {
        code: 'M²',
        companyId: companyId,
      },
    });

    const unUnit = await this.prisma.companyUnitOfMeasure.findFirst({
      where: {
        code: 'UN',
        companyId: companyId,
      },
    });

    if (defaultCategory && m2Unit && unUnit) {
      // Produto 1: Banner Lona
      const bannerProduct = await this.prisma.product.create({
        data: {
          name: 'Banner em Lona',
          code: 'BAN001',
          isActive: true,
          isStandard: false,
          technicalDescription:
            'Banner em lona 440g/m² com impressão digital colorida, acabamento com ilhoses.',
          allowEditValues: true,
          allowEditDescription: true,
          companyId: companyId,
          categoryId: defaultCategory.id,
          sectorId: sector.id,
          items: {
            create: [
              {
                name: 'Impressão Digital',
                unitOfMeasureId: m2Unit.id,
                width: 1,
                height: 1,
                unitCost: 15,
                salePrice: 35,
              },
            ],
          },
        },
      });

      // Produto 2: Adesivo Vinil
      const adesivoProduct = await this.prisma.product.create({
        data: {
          name: 'Adesivo Vinil Branco',
          code: 'ADE001',
          isActive: true,
          isStandard: false,
          technicalDescription:
            'Adesivo em vinil branco com impressão digital, aplicação interna ou externa.',
          allowEditValues: true,
          allowEditDescription: true,
          companyId: companyId,
          categoryId: defaultCategory.id,
          sectorId: sector.id,
          items: {
            create: [
              {
                name: 'Impressão + Material',
                unitOfMeasureId: m2Unit.id,
                width: 1,
                height: 1,
                unitCost: 12,
                salePrice: 28,
              },
            ],
          },
        },
      });

      // Produto 3: Cartão de Visita
      const cartaoProduct = await this.prisma.product.create({
        data: {
          name: 'Cartão de Visita',
          code: 'CAR001',
          isActive: true,
          isStandard: false,
          technicalDescription:
            'Cartão de visita em papel couché 300g, impressão 4x4 cores, formato 9x5cm.',
          allowEditValues: true,
          allowEditDescription: true,
          companyId: companyId,
          categoryId: defaultCategory.id,
          sectorId: sector.id,
          items: {
            create: [
              {
                name: 'Impressão Offset',
                unitOfMeasureId: unUnit.id,
                unitCost: 0.08,
                salePrice: 0.25,
              },
            ],
          },
        },
      });

      console.log(`✅ Produtos padrão criados:`);
      console.log(`   - Banner em Lona: ${bannerProduct.id}`);
      console.log(`   - Adesivo Vinil: ${adesivoProduct.id}`);
      console.log(`   - Cartão de Visita: ${cartaoProduct.id}`);

      // Produto 4: Placa Composta (produto composto com múltiplos itens)
      console.log('Creating composite product...');

      await this.prisma.product.create({
        data: {
          name: 'Placa Acrílico com Suporte',
          code: 'PLA001',
          isActive: true,
          isStandard: false,
          technicalDescription:
            'Placa em acrílico 3mm com impressão digital + suporte em alumínio anodizado.',
          allowEditValues: true,
          allowEditDescription: true,
          companyId: companyId,
          categoryId: defaultCategory.id,
          sectorId: sector.id,
          items: {
            create: [
              {
                name: 'Placa Acrílico 3mm',
                unitOfMeasureId: m2Unit.id,
                width: 1,
                height: 1,
                unitCost: 45,
                salePrice: 85,
              },
              {
                name: 'Impressão Digital UV',
                unitOfMeasureId: m2Unit.id,
                width: 1,
                height: 1,
                unitCost: 25,
                salePrice: 50,
              },
              {
                name: 'Suporte Alumínio',
                unitOfMeasureId: unUnit.id,
                unitCost: 15,
                salePrice: 35,
              },
              {
                name: 'Montagem e Acabamento',
                unitOfMeasureId: unUnit.id,
                unitCost: 10,
                salePrice: 25,
              },
            ],
          },
        },
      });

      console.log(
        '✅ Default products and composite product created successfully',
      );
    } else {
      console.log(
        '⚠️  Não foi possível criar produtos padrão (categoria ou unidades não encontradas)',
      );
    }

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

    console.log('Default client and supplier created successfully');
    // const client: CreateClientDto = {};
    // await this.clientService.create(client, null);

    // Criar orçamento exemplo após todos os dados básicos estarem criados
    await this.createExampleQuotation(companyId);
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

      const { general, address, personalization } = createCompanyDto;

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
    const { general, address, personalization } = updateCompanyDto;
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
}
