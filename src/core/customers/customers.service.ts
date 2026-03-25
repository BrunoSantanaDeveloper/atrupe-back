import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { PrismaService } from 'src/config/prisma/prisma.service';
import axios from 'axios';
import { SystemSettingsService } from '../system-settings/system-settings.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class CustomersService {
  constructor(
    private prisma: PrismaService,
    private readonly settingsService: SystemSettingsService,
  ) {}

  private async asaasApi() {
    const config = await this.settingsService.getActiveAsaasConfig();
    const api = axios.create({
      baseURL: config.url,
      headers: {
        common: {
          'Content-Type': 'application/json',
          access_token: config.token,
          'User-Agent': 'Atrupe',
        },
      },
    });

    return api;
  }

  async create(createCustomerDto: CreateCustomerDto) {
    // Verificar se já existe cliente com o documento informado NA MESMA EMPRESA
    const existingCustomerByDocument = await this.prisma.customer.findFirst({
      where: {
        document: createCustomerDto.document,
        companyId: createCustomerDto.companyId,
      },
    });

    if (existingCustomerByDocument) {
      throw new BadRequestException(
        'Já existe um cliente cadastrado com este documento para esta empresa.',
      );
    }

    // Verificar se já existe cliente com o email informado NA MESMA EMPRESA
    const existingCustomerByEmail = await this.prisma.customer.findFirst({
      where: {
        email: createCustomerDto.email,
        companyId: createCustomerDto.companyId,
      },
    });

    if (existingCustomerByEmail) {
      throw new BadRequestException(
        'Já existe um cliente cadastrado com este e-mail para esta empresa.',
      );
    }

    try {
      // Primeiro criar o customer no banco para obter o ID
      const customer = await this.prisma.customer.create({
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
          asaasCustomerId: `temp_${uuidv4()}`, // Temporário único, será atualizado após criação no Asaas
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

      // Criar cliente no Asaas usando o ID do banco como externalReference
      const customerDataForAsaas = {
        ...createCustomerDto,
        externalReference: customer.id, // ID do banco de dados
      };
      const asaasCustomer =
        await this.createCustomerAsaas(customerDataForAsaas);

      // Atualizar o customer local com o ID do Asaas
      return await this.prisma.customer.update({
        where: { id: customer.id },
        data: {
          asaasCustomerId: asaasCustomer.id,
        },
        include: {
          company: true,
          subscriptions: true,
          user: true,
        },
      });
    } catch (error) {
      console.error(`Error creating customer: ${error}`);
      throw new BadRequestException(error.message);
    }
  }

  private async createCustomerAsaas(
    createCustomerDto: CreateCustomerDto & { externalReference?: string },
  ) {
    const route = '/customers';

    const data = {
      name: createCustomerDto.name,
      cpfCnpj: createCustomerDto.document,
      email: createCustomerDto.email,
      phone: createCustomerDto.phone,
      mobilePhone: createCustomerDto.phone,
      postalCode: createCustomerDto.postalCode, // Enviando postalCode, não é necessário enviar city, province e address, somente addressNumber e complement
      addressNumber: createCustomerDto.addressNumber,
      complement: createCustomerDto.complement,
      externalReference: createCustomerDto.externalReference, // ID do cliente no banco de dados
      // notificationDisabled: false, // true para desabilitar o envio de notificações de cobrança
      // additionalEmails: 'john.doe@asaas.com,john.doe.silva@asaas.com.br', // Emails adicionais para envio de notificações de cobrança separados por ","
      // municipalInscription: '46683695908', // Inscrição municipal do cliente
      // stateInscription: '646681195275', // Inscrição estadual do cliente
      // observations: 'ótimo pagador, nenhum problema até o momento',
      // groupName: null, // Nome do grupo ao qual o cliente pertence
      // company: 'Nome da Empresa',
      // foreignCustomer: false, // informe true caso seja pagador estrangeiro
    };

    console.log('criar cliente asaas:', data);

    try {
      const api = await this.asaasApi();
      const response = await api.post(route, data);
      console.log('response', response.data);
      return response.data;
    } catch (error) {
      const errorResponse = error.response?.data.errors;
      const errorDescription = errorResponse
        ?.map((err) => err.description)
        .join(', ');

      console.error('Error creating customer in Asaas:', {
        message: error.message,
        response: errorResponse,
        status: error.response?.status,
        route,
        data,
      });
      throw new BadRequestException(errorDescription || error.message);
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
      const api = await this.asaasApi();
      const response = await api.put(route, data);
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
      const api = await this.asaasApi();
      await api.delete(route);
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

    // Verificar se o documento está sendo alterado e se já existe outro cliente com o mesmo documento
    if (updateCustomerDto.document) {
      const existingCustomerByDocument = await this.prisma.customer.findFirst({
        where: {
          document: updateCustomerDto.document,
          NOT: {
            id: id,
          },
        },
      });

      if (existingCustomerByDocument) {
        throw new BadRequestException(
          'O documento informado já está sendo usado.',
        );
      }
    }

    // Verificar se o email está sendo alterado e se já existe outro cliente com o mesmo email
    if (updateCustomerDto.email) {
      const existingCustomerByEmail = await this.prisma.customer.findFirst({
        where: {
          email: updateCustomerDto.email,
          NOT: {
            id: id,
          },
        },
      });

      if (existingCustomerByEmail) {
        throw new BadRequestException(
          'O e-mail informado já está sendo usado.',
        );
      }
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
