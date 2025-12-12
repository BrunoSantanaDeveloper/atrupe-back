import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import {
  CreateInvoicyConfigDto,
  UpdateInvoicyConfigDto,
} from './dtos/invoicy-config.dto';

@Injectable()
export class InvoicyService {
  private readonly logger = new Logger(InvoicyService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getConfig(companyId: string) {
    const config = await this.prisma.invoicyConfig.findUnique({
      where: { companyId },
    });

    return config;
  }

  async createConfig(companyId: string, dto: CreateInvoicyConfigDto) {
    return this.prisma.invoicyConfig.create({
      data: {
        ...dto,
        companyId,
      },
    });
  }

  async updateConfig(companyId: string, dto: UpdateInvoicyConfigDto) {
    const config = await this.prisma.invoicyConfig.findUnique({
      where: { companyId },
    });

    if (!config) {
      throw new NotFoundException(
        'Configuração do Invoicy não encontrada para esta empresa',
      );
    }

    return this.prisma.invoicyConfig.update({
      where: { companyId },
      data: dto,
    });
  }

  async upsertConfig(companyId: string, dto: CreateInvoicyConfigDto) {
    return this.prisma.invoicyConfig.upsert({
      where: { companyId },
      create: {
        ...dto,
        companyId,
      },
      update: dto,
    });
  }

  async deleteConfig(companyId: string) {
    const config = await this.prisma.invoicyConfig.findUnique({
      where: { companyId },
    });

    if (!config) {
      throw new NotFoundException(
        'Configuração do Invoicy não encontrada para esta empresa',
      );
    }

    return this.prisma.invoicyConfig.delete({
      where: { companyId },
    });
  }

  async incrementNfeNumber(companyId: string): Promise<number> {
    const config = await this.prisma.invoicyConfig.findUnique({
      where: { companyId },
    });

    if (!config) {
      throw new NotFoundException(
        'Configuração do Invoicy não encontrada para esta empresa',
      );
    }

    const currentNumber = config.proximoNumeroNfe;

    await this.prisma.invoicyConfig.update({
      where: { companyId },
      data: {
        proximoNumeroNfe: currentNumber + 1,
      },
    });

    return currentNumber;
  }

  async testConnection(companyId: string): Promise<boolean> {
    const config = await this.getConfig(companyId);

    if (!config) {
      throw new NotFoundException(
        'Configuração do Invoicy não encontrada para esta empresa',
      );
    }

    try {
      // TODO: Implementar chamada real à API do Invoicy para testar conexão
      this.logger.log(`Testando conexão com Invoicy para empresa ${companyId}`);
      return true;
    } catch (error) {
      this.logger.error(
        `Erro ao testar conexão com Invoicy: ${error.message}`,
        error.stack,
      );
      return false;
    }
  }
}
