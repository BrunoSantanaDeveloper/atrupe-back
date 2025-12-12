import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { CreateInvoicyConfigDto } from './dto/create-invoicy-config.dto';
import { UpdateInvoicyConfigDto } from './dto/update-invoicy-config.dto';
import { InvoicyAuthService } from '../shared/invoicy-auth.service';
import * as crypto from 'crypto';

@Injectable()
export class FiscalConfigService {
  constructor(
    private prisma: PrismaService,
    private authService: InvoicyAuthService,
  ) {}

  /**
   * Cria configuração Invoicy para a empresa
   */
  async create(companyId: string, dto: CreateInvoicyConfigDto) {
    // Verificar se já existe configuração
    const existing = await this.prisma.invoicyConfig.findUnique({
      where: { companyId },
    });

    if (existing) {
      throw new ConflictException('Configuração Invoicy já existe para esta empresa');
    }

    // Verificar se empresa existe e tem CNPJ
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { cnpj: true },
    });

    if (!company) {
      throw new NotFoundException('Empresa não encontrada');
    }

    if (!company.cnpj) {
      throw new BadRequestException('Empresa não possui CNPJ cadastrado');
    }

    // Criptografar credenciais
    const partnerKeyEncrypted = this.encrypt(dto.partnerKey);
    const accessKeyEncrypted = this.encrypt(dto.accessKey);

    // Criar configuração
    return this.prisma.invoicyConfig.create({
      data: {
        companyId,
        partnerKey: partnerKeyEncrypted,
        accessKey: accessKeyEncrypted,
        environment: dto.environment || 'HOMOLOGACAO',
        nfeSeries: dto.nfeSeries || '1',
        nfeNextNumber: dto.nfeNextNumber || 1,
        nfceSeries: dto.nfceSeries || '1',
        nfceNextNumber: dto.nfceNextNumber || 1,
        defaultCfop: dto.defaultCfop || '5102',
        defaultOperationNature: dto.defaultOperationNature || 'Venda de mercadoria',
        taxInfoText: dto.taxInfoText,
      },
    });
  }

  /**
   * Busca configuração da empresa
   */
  async findByCompany(companyId: string) {
    const config = await this.prisma.invoicyConfig.findUnique({
      where: { companyId },
      include: {
        company: {
          select: {
            id: true,
            name: true,
            cnpj: true,
          },
        },
      },
    });

    if (!config) {
      throw new NotFoundException('Configuração Invoicy não encontrada');
    }

    // Não retornar credenciais descriptografadas por segurança
    return {
      ...config,
      partnerKey: '***', // Ocultar
      accessKey: '***', // Ocultar
    };
  }

  /**
   * Atualiza configuração
   */
  async update(companyId: string, dto: UpdateInvoicyConfigDto) {
    const existing = await this.prisma.invoicyConfig.findUnique({
      where: { companyId },
    });

    if (!existing) {
      throw new NotFoundException('Configuração não encontrada');
    }

    const data: any = { ...dto };

    // Criptografar novas credenciais se fornecidas
    if (dto.partnerKey) {
      data.partnerKey = this.encrypt(dto.partnerKey);
    }
    if (dto.accessKey) {
      data.accessKey = this.encrypt(dto.accessKey);
    }

    // Limpar cache de token ao atualizar credenciais
    if (dto.partnerKey || dto.accessKey) {
      this.authService.clearCache(companyId);
      data.currentToken = null;
      data.tokenExpiresAt = null;
    }

    return this.prisma.invoicyConfig.update({
      where: { companyId },
      data,
    });
  }

  /**
   * Remove configuração
   */
  async remove(companyId: string) {
    const existing = await this.prisma.invoicyConfig.findUnique({
      where: { companyId },
    });

    if (!existing) {
      throw new NotFoundException('Configuração não encontrada');
    }

    this.authService.clearCache(companyId);

    return this.prisma.invoicyConfig.delete({
      where: { companyId },
    });
  }

  /**
   * Testa conexão com Invoicy
   */
  async testConnection(
    cnpj: string,
    partnerKey: string,
    accessKey: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const success = await this.authService.testConnection(cnpj, partnerKey, accessKey);
      return {
        success,
        message: success
          ? 'Conexão com Invoicy estabelecida com sucesso'
          : 'Falha ao conectar com Invoicy. Verifique as credenciais.',
      };
    } catch (error) {
      return {
        success: false,
        message: `Erro ao testar conexão: ${error.message}`,
      };
    }
  }

  /**
   * Obtém e incrementa próximo número de NF-e
   */
  async getNextNfeNumber(companyId: string): Promise<number> {
    const config = await this.prisma.invoicyConfig.findUnique({
      where: { companyId },
    });

    if (!config) {
      throw new NotFoundException('Configuração não encontrada');
    }

    const nextNumber = config.nfeNextNumber;

    // Incrementar
    await this.prisma.invoicyConfig.update({
      where: { companyId },
      data: { nfeNextNumber: nextNumber + 1 },
    });

    return nextNumber;
  }

  /**
   * Criptografa string
   */
  private encrypt(text: string): string {
    const algorithm = 'aes-256-cbc';
    const key = Buffer.from(process.env.ENCRYPTION_KEY || 'default-key-32-characters-long!!', 'utf8');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return `${iv.toString('hex')}:${encrypted}`;
  }

  /**
   * Descriptografa string (para uso interno)
   */
  decrypt(encrypted: string): string {
    const algorithm = 'aes-256-cbc';
    const key = Buffer.from(process.env.ENCRYPTION_KEY || 'default-key-32-characters-long!!', 'utf8');
    const parts = encrypted.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = parts[1];
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}
