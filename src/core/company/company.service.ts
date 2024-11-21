import { Injectable } from '@nestjs/common';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { PrismaService } from 'nestjs-prisma';
import { AddressService } from '../address/address.service';
import { PlugService } from '../../svc/plug/plug.service';
import { Company } from '@prisma/client';

@Injectable()
export class CompanyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly addressService: AddressService,
    private readonly plugService: PlugService,
  ) {}

  async create(createCompanyDto: CreateCompanyDto): Promise<Company> {
    try {
      // if (createCompanyDto.address && company) {
      //   await this.addressService.create(
      //     createCompanyDto.address,
      //     OwnerType.COMPANY,
      //     company.id,
      //   );
      // }

      return await this.prisma.company.create({
        data: {
          ...createCompanyDto,
          cnpj: createCompanyDto.cnpj.replace(/\D/g, ''),
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
    return this.prisma.company.update({
      where: { id: id },
      data: updateCompanyDto,
    });
  }

  remove(id: string) {
    return this.prisma.company.delete({
      where: { id: id },
    });
  }
}
