import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { NfseStatus } from '@prisma/client';

/**
 * NfseDraftService - Gestão de rascunhos de NFS-e
 *
 * Este service é responsável pelo ciclo de vida de rascunhos (drafts) de NFS-e:
 * - Criação de novos rascunhos
 * - Atualização de dados do rascunho
 * - Deleção de rascunhos
 *
 * Similar ao NfeDraftService, implementa o fluxo de rascunho para NFS-e.
 */

export interface CreateNfseDraftDto {
  orderId?: string;
  quotationId?: string;
  tomador?: {
    cnpj?: string;
    cpf?: string;
    razaoSocial: string;
    endereco?: string;
    numero?: string;
    bairro?: string;
    codigoMunicipio?: string;
    municipio?: string;
    uf?: string;
    cep?: string;
    email?: string;
    telefone?: string;
  };
  codigoServico?: string;
  discriminacao?: string;
  valorServicos?: number;
  aliquotaIss?: number;
  issRetido?: boolean;
}

export interface UpdateNfseDraftDto {
  tomador?: {
    cnpj?: string;
    cpf?: string;
    razaoSocial?: string;
    endereco?: string;
    numero?: string;
    bairro?: string;
    codigoMunicipio?: string;
    municipio?: string;
    uf?: string;
    cep?: string;
    email?: string;
    telefone?: string;
  };
  codigoServico?: string;
  discriminacao?: string;
  valorServicos?: number;
  valorDeducoes?: number;
  aliquotaIss?: number;
  issRetido?: boolean;
  valorPis?: number;
  valorCofins?: number;
  valorInss?: number;
  valorIr?: number;
  valorCsll?: number;
}

@Injectable()
export class NfseDraftService {
  private readonly logger = new Logger(NfseDraftService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Busca rascunho existente para uma ordem
   */
  async findDraftByOrderId(
    companyId: string,
    orderId: string,
    ambiente?: number,
  ): Promise<any | null> {
    return this.prisma.nfse.findFirst({
      where: {
        companyId,
        orderId,
        status: NfseStatus.DRAFT,
        ...(ambiente ? { ambiente } : {}),
      },
    });
  }

  /**
   * Busca rascunho pelo ID
   */
  async findDraftById(companyId: string, draftId: string): Promise<any | null> {
    return this.prisma.nfse.findFirst({
      where: {
        id: draftId,
        companyId,
        status: NfseStatus.DRAFT,
      },
    });
  }

  /**
   * Mescla dados preparados com dados do rascunho existente
   */
  mergeDraftWithPreparedData(draft: any, preparedData: any): any {
    const draftData = (draft.draftData as Record<string, any>) || {};

    return {
      ...preparedData,
      draftId: draft.id,
      isDraft: true,
      // Sobrescrever com dados do rascunho
      tomador: draftData.tomador || preparedData.tomador,
      codigoServico: draftData.codigoServico || preparedData.codigoServico,
      discriminacao: draftData.discriminacao || preparedData.discriminacao,
      valorServicos: draftData.valorServicos ?? preparedData.valorServicos,
      valorDeducoes: draftData.valorDeducoes ?? preparedData.valorDeducoes,
      aliquotaIss: draftData.aliquotaIss ?? preparedData.aliquotaIss,
      issRetido: draftData.issRetido ?? preparedData.issRetido,
    };
  }

  /**
   * Cria um novo rascunho de NFS-e
   */
  async createDraft(
    companyId: string,
    dto: CreateNfseDraftDto,
    config: any,
  ): Promise<any> {
    const ambiente =
      (config?.activeEnvironmentNfse ||
        config?.activeEnvironment ||
        config?.environment) === 'PRODUCAO' || config?.ambiente === 1
        ? 1
        : 2;
    if (!config) {
      throw new BadRequestException('Configuração do Invoicy não encontrada.');
    }

    // Verificar se já existe rascunho para a ordem
    if (dto.orderId) {
      const existingDraft = await this.findDraftByOrderId(
        companyId,
        dto.orderId,
        ambiente,
      );
      if (existingDraft) {
        this.logger.log(
          `Rascunho já existe para ordem ${dto.orderId}: ${existingDraft.id}`,
        );
        return {
          draftId: existingDraft.id,
          isDraft: true,
          ...this.mergeDraftWithPreparedData(existingDraft, dto),
        };
      }
    }

    // Numeração provisória do rascunho: sai da linha ambiental, não da coluna
    // global de invoicy_configs — a reserva definitiva no envio lê de lá.
    const rpsNumero =
      config.activeNumbering?.nfse?.nextNumber ?? config.proximoRpsNfse ?? 1;
    const rpsSerie =
      config.activeNumbering?.nfse?.series ?? config.serieNfse ?? '1';

    const draft = await this.prisma.nfse.create({
      data: {
        companyId,
        orderId: dto.orderId || null,
        quotationId: dto.quotationId || null,
        numero: 0, // Será preenchido após autorização
        serie: rpsSerie,
        rpsNumero,
        rpsSerie,
        rpsTipo: 1,
        status: NfseStatus.DRAFT,
        ambiente,
        valorServicos: dto.valorServicos || 0,
        codigoServico: dto.codigoServico,
        discriminacao: dto.discriminacao,
        aliquotaIss: dto.aliquotaIss || config.aliquotaIss || 0,
        issRetido: dto.issRetido || false,
        draftData: JSON.parse(
          JSON.stringify({
            tomador: dto.tomador,
            codigoServico: dto.codigoServico,
            discriminacao: dto.discriminacao,
            valorServicos: dto.valorServicos,
            aliquotaIss: dto.aliquotaIss,
            issRetido: dto.issRetido,
          }),
        ),
      },
    });

    this.logger.log(
      `Rascunho de NFS-e criado: ${draft.id}${dto.orderId ? ` para ordem ${dto.orderId}` : ''}`,
    );

    return {
      draftId: draft.id,
      isDraft: true,
      tomador: dto.tomador,
      codigoServico: dto.codigoServico,
      discriminacao: dto.discriminacao,
      valorServicos: dto.valorServicos,
      aliquotaIss: dto.aliquotaIss,
      issRetido: dto.issRetido,
    };
  }

  /**
   * Atualiza os dados de um rascunho
   */
  async updateDraft(
    companyId: string,
    draftId: string,
    dto: UpdateNfseDraftDto,
  ): Promise<any> {
    const draft = await this.findDraftById(companyId, draftId);

    if (!draft) {
      throw new NotFoundException('Rascunho não encontrado');
    }

    const existingDraftData = (draft.draftData as Record<string, any>) || {};

    // Mesclar dados existentes com novos dados
    const updatedDraftData = {
      ...existingDraftData,
      ...(dto.tomador && {
        tomador: { ...existingDraftData.tomador, ...dto.tomador },
      }),
      ...(dto.codigoServico && { codigoServico: dto.codigoServico }),
      ...(dto.discriminacao && { discriminacao: dto.discriminacao }),
      ...(dto.valorServicos !== undefined && {
        valorServicos: dto.valorServicos,
      }),
      ...(dto.valorDeducoes !== undefined && {
        valorDeducoes: dto.valorDeducoes,
      }),
      ...(dto.aliquotaIss !== undefined && { aliquotaIss: dto.aliquotaIss }),
      ...(dto.issRetido !== undefined && { issRetido: dto.issRetido }),
      ...(dto.valorPis !== undefined && { valorPis: dto.valorPis }),
      ...(dto.valorCofins !== undefined && { valorCofins: dto.valorCofins }),
      ...(dto.valorInss !== undefined && { valorInss: dto.valorInss }),
      ...(dto.valorIr !== undefined && { valorIr: dto.valorIr }),
      ...(dto.valorCsll !== undefined && { valorCsll: dto.valorCsll }),
    };

    // Atualizar também os campos principais do registro
    const updatedDraft = await this.prisma.nfse.update({
      where: { id: draftId },
      data: {
        draftData: JSON.parse(JSON.stringify(updatedDraftData)),
        ...(dto.valorServicos !== undefined && {
          valorServicos: dto.valorServicos,
        }),
        ...(dto.valorDeducoes !== undefined && {
          valorDeducoes: dto.valorDeducoes,
        }),
        ...(dto.aliquotaIss !== undefined && { aliquotaIss: dto.aliquotaIss }),
        ...(dto.issRetido !== undefined && { issRetido: dto.issRetido }),
        ...(dto.codigoServico && { codigoServico: dto.codigoServico }),
        ...(dto.discriminacao && { discriminacao: dto.discriminacao }),
      },
    });

    this.logger.log(`Rascunho de NFS-e atualizado: ${draftId}`);

    return {
      id: updatedDraft.id,
      success: true,
      draftData: updatedDraftData,
    };
  }

  /**
   * Deleta um rascunho (cancelar digitação)
   */
  async deleteDraft(companyId: string, draftId: string): Promise<any> {
    const draft = await this.findDraftById(companyId, draftId);

    if (!draft) {
      throw new NotFoundException('Rascunho não encontrado');
    }

    await this.prisma.nfse.delete({
      where: { id: draftId },
    });

    this.logger.log(`Rascunho de NFS-e deletado: ${draftId}`);

    return {
      success: true,
      message: 'Rascunho deletado com sucesso',
    };
  }

  /**
   * Lista todos os rascunhos de uma empresa
   */
  async listDrafts(companyId: string): Promise<any[]> {
    return this.prisma.nfse.findMany({
      where: {
        companyId,
        status: NfseStatus.DRAFT,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        order: {
          include: {
            quotation: {
              include: {
                client: true,
              },
            },
          },
        },
      },
    });
  }
}
