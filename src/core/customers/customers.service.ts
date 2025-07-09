import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { PrismaService } from 'src/config/prisma/prisma.service';
import axios from 'axios';
import { asaasConfig } from 'src/config/configuration';

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}
  private asaasToken = asaasConfig.token;
  private asaasApiUrl = asaasConfig.apiUrl;
  private isMockMode = asaasConfig.mockMode;

  async create(createCustomerDto: CreateCustomerDto) {
    const asaasCustomer = await this.createCustomerAsaas(createCustomerDto);
    try {
      return await this.prisma.customer.create({
        data: {
          name: createCustomerDto.name,
          email: createCustomerDto.email,
          document: createCustomerDto.document,
          phone: createCustomerDto.phone,
          address: createCustomerDto.address,
          addressNumber: createCustomerDto.addressNumber,
          complement: createCustomerDto.complement,
          province: createCustomerDto.province,
          postalCode: createCustomerDto.postalCode,
          city: createCustomerDto.city,
          state: createCustomerDto.state,
          asaasCustomerId: asaasCustomer.id,
          companyId: createCustomerDto.companyId,
          user: {
            connect: {
              id: createCustomerDto.userId,
            },
          },
        },
        include: {
          company: true,
          subscriptions: true,
          user: true,
        },
      });
    } catch (error) {
      console.error(error);
      throw new BadRequestException(
        'Error creating customer: ' + error.message,
      );
    }
  }

  private async createCustomerAsaas(createCustomerDto: CreateCustomerDto) {
    if (this.isMockMode) {
      return this.mockCreateCustomer(createCustomerDto);
    }

    const route = `${this.asaasApiUrl}/customers`;
    console.log('Route:', route);
    const data = {
      name: createCustomerDto.name,
      cpfCnpj: createCustomerDto.document,
      email: createCustomerDto.email,
      phone: createCustomerDto.phone,
      mobilePhone: createCustomerDto.phone,
      postalCode: createCustomerDto.postalCode,
      addressNumber: createCustomerDto.addressNumber,
    };

    try {
      const response = await axios.post(route, data, {
        headers: {
          'Content-Type': 'application/json',
          access_token: this.asaasToken,
          'User-Agent': 'Atrupe',
        },
      });
      console.log('response', response.data);
      return response.data;
    } catch (error) {
      console.error('Error creating customer in Asaas:', {
        message: error.message,
        response: error.response?.data.errors,
        status: error.response?.status,
        route,
        data,
      });
      throw new BadRequestException(
        `Error creating customer in Asaas: ${error.message}`,
      );
    }
  }

  private mockCreateCustomer(createCustomerDto: CreateCustomerDto): any {
    console.log('🎭 MOCK MODE: Simulando criação de customer no Asaas');
    console.log('Dados do customer:', createCustomerDto);

    return {
      id: `cus_mock_${Date.now()}`,
      name: createCustomerDto.name,
      email: createCustomerDto.email,
      cpfCnpj: createCustomerDto.document,
      phone: createCustomerDto.phone,
      mobilePhone: createCustomerDto.phone,
      postalCode: createCustomerDto.postalCode,
      addressNumber: createCustomerDto.addressNumber,
      dateCreated: new Date().toISOString(),
      object: 'customer',
    };
  }

  async findAll() {
    return this.prisma.customer.findMany({
      include: {
        company: true,
        subscriptions: true,
      },
    });
  }

  async findOne(id: string) {
    return this.prisma.customer.findUnique({
      where: { id },
      include: {
        company: true,
        subscriptions: true,
      },
    });
  }

  async update(id: string, updateCustomerDto: UpdateCustomerDto) {
    return this.prisma.customer.update({
      where: { id },
      data: updateCustomerDto,
      include: {
        company: true,
        subscriptions: true,
      },
    });
  }

  async remove(id: string) {
    return this.prisma.customer.delete({
      where: { id },
    });
  }
}
