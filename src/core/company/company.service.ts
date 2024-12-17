import { Injectable } from '@nestjs/common';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { AddressService } from '../address/address.service';
import { PlugService } from '../../svc/plug/plug.service';
import { Company } from '@prisma/client';
import { PrismaService } from 'src/config/prisma/prisma.service';

@Injectable()
export class CompanyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly addressService: AddressService,
    private readonly plugService: PlugService,
  ) {}

  async create(createCompanyDto: CreateCompanyDto): Promise<Company> {
    try {
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

  findAll() {
    return `This action returns all company`;
  }

  findOne(id: string) {
    return this.prisma.company.findFirst({ where: { id: id } });
  }

  async update(id: string, updateCompanyDto: UpdateCompanyDto) {
    const { general, address, personalization } = updateCompanyDto;

    try {
      // First update the company
      const updatedCompany = await this.prisma.company.update({
        where: { id },
        data: {
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
        },
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
