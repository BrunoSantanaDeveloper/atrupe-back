import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { InvoicyHttpService } from '../invoicy/invoicy-http.service';
import { InvoicyService } from '../invoicy/invoicy.service';
import { FiscalOnboardingDto } from './fiscal-onboarding.dto';
import { validatePfxCertificateCnpj } from '../utils/certificate-parser';

@Injectable()
export class FiscalOnboardingService {
  private readonly logger = new Logger(FiscalOnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoicyHttpService: InvoicyHttpService,
    private readonly invoicyService: InvoicyService,
  ) {}

  async submitOnboarding(companyId: string, dto: FiscalOnboardingDto) {
    if (dto.certificate) {
      const validation = validatePfxCertificateCnpj(
        dto.certificate,
        dto.certificatePassword || '',
        dto.cnpj,
      );

      if (!validation.valid) {
        throw new BadRequestException(validation.message);
      }
    }

    // Check for existing active onboarding
    const existing = await this.prisma.fiscalOnboardingRequest.findFirst({
      where: {
        companyId,
        status: { in: ['ACTIVE', 'PROVISIONING'] },
      },
    });

    if (existing?.status === 'ACTIVE') {
      throw new BadRequestException('Módulo fiscal já está ativo');
    }

    if (existing?.status === 'PROVISIONING') {
      throw new BadRequestException('Configuração fiscal já está em andamento');
    }

    // Create the onboarding request
    const request = await this.prisma.fiscalOnboardingRequest.create({
      data: {
        companyId,
        status: 'PROVISIONING',
        cnpj: dto.cnpj.replace(/\D/g, ''),
        razaoSocial: dto.razaoSocial,
        nomeFantasia: dto.nomeFantasia,
        ie: dto.ie,
        im: dto.im,
        cnae: dto.cnae,
        uf: dto.uf,
        codigoIbge: dto.codigoIbge,
        cep: dto.cep?.replace(/\D/g, ''),
        logradouro: dto.logradouro,
        numero: dto.numero,
        bairro: dto.bairro,
        cidade: dto.cidade,
        complemento: dto.complemento,
      },
    });

    // Try auto-provisioning
    try {
      await this.autoProvision(request, dto);
      return {
        status: 'ACTIVE',
        message: 'Módulo fiscal ativado com sucesso!',
        onboardingId: request.id,
      };
    } catch (error) {
      this.logger.error(
        `Auto-provisioning failed for company ${companyId}: ${error.message}`,
      );
      await this.markForReview(request.id, error.message);
      return {
        status: 'PENDING_REVIEW',
        message:
          'Dados recebidos com sucesso. A configuração será concluída pela equipe Atrupe em breve.',
        onboardingId: request.id,
      };
    }
  }

  private async autoProvision(request: any, dto: FiscalOnboardingDto) {
    // 1. Register company in Invoicy via partner API
    const registrationResult = await this.invoicyHttpService.registerCompany({
      cnpj: request.cnpj,
      razaoSocial: request.razaoSocial,
      nomeFantasia: request.nomeFantasia || request.razaoSocial,
      ie: request.ie,
      im: request.im,
      uf: request.uf,
      codigoIbge: request.codigoIbge,
      cep: request.cep,
      logradouro: request.logradouro,
      numero: request.numero,
      bairro: request.bairro,
      cidade: request.cidade,
      complemento: request.complemento,
      certificate: dto.certificate,
      certificatePassword: dto.certificatePassword,
      certificateType: dto.certificateType,
      environment: 'HOMOLOGACAO',
    });

    // 2. Save accessKey on the Company record + create InvoicyConfig
    await this.activateModule(
      request.id,
      request.companyId,
      registrationResult.accessKey,
      registrationResult.cryptoKey,
      registrationResult.environment,
      {
        certificate: dto.certificate,
        certificatePassword: dto.certificatePassword,
        certificateType: dto.certificateType,
      },
    );

    return registrationResult;
  }

  private async activateModule(
    requestId: string,
    companyId: string,
    accessKey: string,
    cryptoKey?: string,
    environment: 'PRODUCAO' | 'HOMOLOGACAO' = 'HOMOLOGACAO',
    certificateData?: {
      certificate?: string;
      certificatePassword?: string;
      certificateType?: string;
    },
  ) {
    await this.prisma.$transaction(async (tx) => {
      // Fetch the onboarding request to get the submitted data
      const request = await tx.fiscalOnboardingRequest.findUnique({
        where: { id: requestId },
      });

      // Update company with Invoicy accessKey + sync onboarding data
      await tx.company.update({
        where: { id: companyId },
        data: {
          accessKey,
          ...(request?.razaoSocial && { legalName: request.razaoSocial }),
          ...(request?.cnpj && { cnpj: request.cnpj }),
          ...(request?.cnae && { cnae: request.cnae }),
          ...(request?.ie && { stateRegistration: request.ie }),
          ...(request?.im && { municipalRegistration: request.im }),
        },
      });

      // Upsert primary address from onboarding data
      if (request?.logradouro || request?.cep) {
        const existingAddress = await tx.address.findFirst({
          where: { companyId, type: 'Principal' },
        });

        const addressData = {
          street: request.logradouro || '',
          number: request.numero || '',
          neighborhood: request.bairro || '',
          zipcode: request.cep || '',
          city: request.cidade || '',
          state: request.uf || '',
          country: '1058',
          type: 'Principal',
          companyId,
        };

        if (existingAddress) {
          await tx.address.update({
            where: { id: existingAddress.id },
            data: addressData,
          });
        } else {
          await tx.address.create({ data: addressData });
        }
      }

      if (certificateData?.certificate) {
        await tx.digitalCertificate.upsert({
          where: { companyId },
          create: {
            companyId,
            type: (certificateData.certificateType as any) || 'A1',
            password: certificateData.certificatePassword,
            certificate: certificateData.certificate,
            lastUpload: new Date(),
          },
          update: {
            type: (certificateData.certificateType as any) || 'A1',
            password: certificateData.certificatePassword,
            certificate: certificateData.certificate,
            lastUpload: new Date(),
          },
        });
      }

      // Create default InvoicyConfig (emissor)
      const existingConfig = await tx.invoicyConfig.findFirst({
        where: { companyId, isDefault: true },
      });

      if (!existingConfig) {
        await tx.invoicyConfig.create({
          data: {
            companyId,
            name: 'Matriz',
            isDefault: true,
            environment,
            ambiente: environment === 'PRODUCAO' ? 1 : 2,
            emitCrt: 1,
            serieNfe: 1,
            proximoNumeroNfe: 1,
            serieNfce: 1,
            proximoNumeroNfce: 1,
          },
        });
      }

      // Update onboarding request status
      await tx.fiscalOnboardingRequest.update({
        where: { id: requestId },
        data: {
          status: 'ACTIVE',
          invoicyAccessKey: accessKey,
          invoicyCryptoKey: cryptoKey,
          resolvedAt: new Date(),
        },
      });

      // Execute auto-seeding
      await this.seedDefaultFiscalData(tx, companyId);
    });
  }

  private async seedDefaultFiscalData(tx: any, companyId: string) {
    // 1. Seed default CFOPs (essenciais para Simples Nacional)
    const defaultCfops = [
      // Saídas — Mercadorias
      {
        code: '5101',
        description: 'Venda de produção do estabelecimento',
        type: 'SAIDA',
      },
      {
        code: '5102',
        description: 'Venda de mercadoria adquirida ou recebida de terceiros',
        type: 'SAIDA',
      },
      // Saídas — Fora do estado
      {
        code: '6101',
        description: 'Venda de produção do estabelecimento (fora do estado)',
        type: 'SAIDA',
      },
      {
        code: '6102',
        description:
          'Venda de mercadoria adquirida ou recebida de terceiros (fora do estado)',
        type: 'SAIDA',
      },
      // Saídas — Serviços (NFS-e)
      {
        code: '5933',
        description:
          'Prestação de serviços compreendidos em mais de uma tributação municipal',
        type: 'SAIDA',
      },
      // Entradas — Compras
      {
        code: '1102',
        description:
          'Compra para comercialização (entrada de mercadoria adquirida de terceiro)',
        type: 'ENTRADA',
      },
      {
        code: '1403',
        description: 'Compra para uso ou consumo',
        type: 'ENTRADA',
      },
    ];

    for (const cfop of defaultCfops) {
      const exists = await tx.cfopConfig.findFirst({
        where: { companyId, code: cfop.code },
      });
      if (!exists) {
        await tx.cfopConfig.create({
          data: {
            companyId,
            code: cfop.code,
            description: cfop.description,
            type: cfop.type,
            isActive: true,
          },
        });
        this.logger.log(`Seeded CFOP ${cfop.code} for company ${companyId}`);
      }
    }

    // 2. Seed ProductFiscalData for ALL existing products without fiscal data
    const products = await tx.product.findMany({
      where: { companyId },
      include: { fiscalData: true },
    });

    let seededCount = 0;
    for (const product of products) {
      if (!product.fiscalData) {
        await tx.productFiscalData.create({
          data: {
            productId: product.id,
            ncm: '00000000', // Placeholder — usuário deve atualizar por produto
            cfopInState: '5102', // Padrão: venda de mercadoria terceiros (dentro do estado)
            cfopOutState: '6102', // Padrão: venda de mercadoria terceiros (fora do estado)
            commercialUnit: 'UN',
            icmsOrigin: '0', // Nacional
            icmsCst: '102', // Simples Nacional sem permissão de crédito
            pisCst: '99', // Outras operações
            cofinsCst: '99', // Outras operações
            ipiCst: '99', // Outras saídas
          },
        });
        seededCount++;
      }
    }

    if (seededCount > 0) {
      this.logger.log(
        `Seeded fiscal data for ${seededCount} products of company ${companyId}`,
      );
    }
  }

  /**
   * Trigger seed of default CFOPs and product fiscal data for a company.
   * Used by the admin endpoint to apply defaults to already-active companies.
   */
  async seedFiscalDataForCompany(companyId: string) {
    await this.prisma.$transaction(async (tx) => {
      await this.seedDefaultFiscalData(tx, companyId);
    });
    return {
      success: true,
      message: 'CFOPs e dados fiscais de produtos aplicados com sucesso',
    };
  }

  private async markForReview(requestId: string, errorMessage: string) {
    await this.prisma.fiscalOnboardingRequest.update({
      where: { id: requestId },
      data: {
        status: 'PENDING_REVIEW',
        errorMessage,
      },
    });
  }

  private async tryActivatePendingReview(request: any): Promise<boolean> {
    try {
      const result = await this.invoicyHttpService.registerCompany({
        cnpj: request.cnpj,
        razaoSocial: request.razaoSocial,
        nomeFantasia: request.nomeFantasia || request.razaoSocial,
        ie: request.ie,
        im: request.im,
        uf: request.uf,
        codigoIbge: request.codigoIbge,
        cep: request.cep,
        logradouro: request.logradouro,
        numero: request.numero,
        bairro: request.bairro,
        cidade: request.cidade,
        complemento: request.complemento,
        environment: 'HOMOLOGACAO',
      });

      await this.activateModule(
        request.id,
        request.companyId,
        result.accessKey,
        result.cryptoKey,
        result.environment,
      );

      return true;
    } catch (error) {
      this.logger.warn(
        `Pending fiscal onboarding reconciliation failed for company ${request.companyId}: ${error.message}`,
      );
      return false;
    }
  }

  async getStatus(companyId: string) {
    const request = await this.prisma.fiscalOnboardingRequest.findFirst({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });

    const hasConfig = await this.prisma.invoicyConfig.findFirst({
      where: { companyId, isDefault: true },
    });

    if (!request) {
      if (hasConfig) {
        // Se pulou o onboarding wizard e criou manual, consideramos ATIVO
        return {
          status: 'ACTIVE',
          hasConfig: true,
          createdAt: hasConfig.createdAt,
        };
      }
      return { status: 'NOT_STARTED', hasConfig: false };
    }

    if (request.status === 'PENDING_REVIEW') {
      if (hasConfig) {
        await this.prisma.fiscalOnboardingRequest.update({
          where: { id: request.id },
          data: {
            status: 'ACTIVE',
            resolvedAt: new Date(),
            errorMessage: null,
          },
        });

        return {
          status: 'ACTIVE',
          hasConfig: true,
          createdAt: request.createdAt,
        };
      }

      const activated = await this.tryActivatePendingReview(request);
      if (activated) {
        return {
          status: 'ACTIVE',
          hasConfig: true,
          createdAt: request.createdAt,
        };
      }
    }

    return {
      status: request.status,
      hasConfig: !!hasConfig,
      createdAt: request.createdAt,
      errorMessage:
        request.status === 'PENDING_REVIEW' ? request.errorMessage : undefined,
    };
  }

  // ============== Admin endpoints ==============

  async listPending() {
    return this.prisma.fiscalOnboardingRequest.findMany({
      where: { status: 'PENDING_REVIEW' },
      include: {
        company: {
          select: { name: true, legalName: true, cnpj: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async adminApprove(
    requestId: string,
    adminUserId: string,
    accessKey: string,
  ) {
    const request = await this.prisma.fiscalOnboardingRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException('Onboarding request not found');
    }

    if (request.status !== 'PENDING_REVIEW') {
      throw new BadRequestException(
        `Cannot approve request with status: ${request.status}`,
      );
    }

    await this.activateModule(
      requestId,
      request.companyId,
      accessKey,
      undefined,
      'HOMOLOGACAO',
    );

    await this.prisma.fiscalOnboardingRequest.update({
      where: { id: requestId },
      data: { resolvedBy: adminUserId },
    });

    return { success: true, message: 'Módulo fiscal ativado pelo admin' };
  }

  async adminRetry(requestId: string) {
    const request = await this.prisma.fiscalOnboardingRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException('Onboarding request not found');
    }

    await this.prisma.fiscalOnboardingRequest.update({
      where: { id: requestId },
      data: { status: 'PROVISIONING', errorMessage: null },
    });

    try {
      const result = await this.invoicyHttpService.registerCompany({
        cnpj: request.cnpj,
        razaoSocial: request.razaoSocial,
        nomeFantasia: request.nomeFantasia || request.razaoSocial,
        ie: request.ie,
        im: request.im,
        uf: request.uf,
        codigoIbge: request.codigoIbge,
        cep: request.cep,
        logradouro: request.logradouro,
        numero: request.numero,
        bairro: request.bairro,
        cidade: request.cidade,
        complemento: request.complemento,
        environment: 'HOMOLOGACAO',
      });

      await this.activateModule(
        requestId,
        request.companyId,
        result.accessKey,
        result.cryptoKey,
        result.environment,
      );

      return { success: true, message: 'Auto-provisioning succeeded on retry' };
    } catch (error) {
      await this.markForReview(requestId, error.message);
      throw error;
    }
  }
}
