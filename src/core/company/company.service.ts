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
            textBeforeItems: personalization?.textsBeforeItems,
            textAfterItems: personalization?.textsAfterItems,

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
        code: 'V2',
        title: 'Orçamento',
        description: 'Vendas Diversas',
        companyId: companyId,
        proposalValidity: 30,
        deliveryDeadline: 30,
        billing: 'ON_ORDER',
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
          textBeforeItems: personalization?.textsBeforeItems,
          textAfterItems: personalization?.textsAfterItems,

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
          await this.prisma.address.updateMany({
            where: {
              ownerId: id,
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
        } else {
          // Create new address
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
              ownerId: id,
            },
          });
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
