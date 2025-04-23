import { Injectable } from '@nestjs/common';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { AddressService } from '../address/address.service';
import { PlugService } from '../../svc/plug/plug.service';
import { Company, Prisma } from '@prisma/client';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';

@Injectable()
export class CompanyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly addressService: AddressService,
    private readonly plugService: PlugService,
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

            console.log('Creating employee record');
            await tx.employee.create({
              data: {
                name: user.name,
                companyId: companyId,
                roleId: role.id,
                userId: user.id,
                sectorId: sector.id,
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
