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
import { FiscalOnboardingStatus } from '@prisma/client';

@Injectable()
export class FiscalOnboardingService {
  private readonly logger = new Logger(FiscalOnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoicyHttpService: InvoicyHttpService,
    private readonly invoicyService: InvoicyService,
  ) {}

  async submitOnboarding(companyId: string, dto: FiscalOnboardingDto) {
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
      throw new BadRequestException(
        'Configuração fiscal já está em andamento',
      );
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
      const result = await this.autoProvision(request, dto);
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

  private async autoProvision(
    request: any,
    dto: FiscalOnboardingDto,
  ) {
    // 1. Register company in Invoicy via partner API
    const registrationResult =
      await this.invoicyHttpService.registerCompany({
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
      });

    // 2. Save accessKey on the Company record + create InvoicyConfig
    await this.activateModule(
      request.id,
      request.companyId,
      registrationResult.accessKey,
      registrationResult.cryptoKey,
    );

    return registrationResult;
  }

  private async activateModule(
    requestId: string,
    companyId: string,
    accessKey: string,
    cryptoKey?: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      // Update company with the Invoicy accessKey
      await tx.company.update({
        where: { id: companyId },
        data: { accessKey },
      });

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
            environment: 'HOMOLOGACAO',
            ambiente: 2,
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
    });
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

  async getStatus(companyId: string) {
    const request = await this.prisma.fiscalOnboardingRequest.findFirst({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });

    if (!request) {
      return { status: 'NOT_STARTED', hasConfig: false };
    }

    const hasConfig = await this.prisma.invoicyConfig.findFirst({
      where: { companyId, isDefault: true },
    });

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

    await this.activateModule(requestId, request.companyId, accessKey);

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
      });

      await this.activateModule(
        requestId,
        request.companyId,
        result.accessKey,
        result.cryptoKey,
      );

      return { success: true, message: 'Auto-provisioning succeeded on retry' };
    } catch (error) {
      await this.markForReview(requestId, error.message);
      throw error;
    }
  }
}
