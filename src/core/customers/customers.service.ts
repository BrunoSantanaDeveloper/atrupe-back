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

  private asaasApi() {
    return axios.create({
      baseURL: this.asaasApiUrl,
      headers: {
        common: {
          'Content-Type': 'application/json',
          access_token: this.asaasToken,
          'User-Agent': 'Atrupe',
        },
      },
    });
  }

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
    const route = '/customers';

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
      const response = await this.asaasApi().post(route, data);
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

  private async updateCustomerAsaas(
    asaasCustomerId: string,
    updateCustomerDto: UpdateCustomerDto,
  ) {
    const route = `/customers/${asaasCustomerId}`;
    const data: any = {};

    // Mapear apenas os campos que foram enviados
    if (updateCustomerDto.name) data.name = updateCustomerDto.name;
    if (updateCustomerDto.email) data.email = updateCustomerDto.email;
    if (updateCustomerDto.phone) {
      data.phone = updateCustomerDto.phone;
      data.mobilePhone = updateCustomerDto.phone;
    }
    if (updateCustomerDto.postalCode)
      data.postalCode = updateCustomerDto.postalCode;
    if (updateCustomerDto.addressNumber)
      data.addressNumber = updateCustomerDto.addressNumber;
    if (updateCustomerDto.address) data.address = updateCustomerDto.address;
    if (updateCustomerDto.province) data.province = updateCustomerDto.province;

    try {
      const response = await this.asaasApi().put(route, data);
      return response.data;
    } catch (error) {
      console.error('Error updating customer in Asaas:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
        asaasCustomerId,
      });
      // Não lançar erro para não bloquear a atualização local
      console.warn(
        'Customer update failed in Asaas, but local update will continue',
      );
    }
  }

  private async deleteCustomerAsaas(asaasCustomerId: string) {
    const route = `/customers/${asaasCustomerId}`;

    try {
      await this.asaasApi().delete(route);
    } catch (error) {
      console.error('Error deleting customer in Asaas:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
        asaasCustomerId,
      });
      // Não lançar erro para não bloquear a remoção local
      console.warn(
        'Customer deletion failed in Asaas, but local deletion will continue',
      );
    }
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
    // Buscar customer para obter asaasCustomerId
    const customer = await this.prisma.customer.findUnique({
      where: { id },
    });

    if (!customer) {
      throw new BadRequestException('Customer not found');
    }

    // Atualizar no Asaas se não for um customer trial/temporário
    if (
      customer.asaasCustomerId &&
      !customer.asaasCustomerId.startsWith('trial_')
    ) {
      await this.updateCustomerAsaas(
        customer.asaasCustomerId,
        updateCustomerDto,
      );
    }

    // Atualizar localmente
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
    // Buscar customer para obter asaasCustomerId
    const customer = await this.prisma.customer.findUnique({
      where: { id },
    });

    if (!customer) {
      throw new BadRequestException('Customer not found');
    }

    // Deletar no Asaas se não for um customer trial/temporário
    if (
      customer.asaasCustomerId &&
      !customer.asaasCustomerId.startsWith('trial_')
    ) {
      await this.deleteCustomerAsaas(customer.asaasCustomerId);
    }

    // Deletar localmente
    return this.prisma.customer.delete({
      where: { id },
    });
  }
}
