import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { NfeStatus } from '@prisma/client';
import { UpdateNfeDraftDto } from './dtos/nfe.dto';

/**
 * NfeDraftService - Gestão de rascunhos de NF-e
 *
 * Este service é responsável pelo ciclo de vida de rascunhos (drafts):
 * - Criação de novos rascunhos
 * - Atualização de dados do rascunho
 * - Deleção de rascunhos
 *
 * Separação de responsabilidades:
 * - NfeService: Orquestração e emissão
 * - NfeDraftService: Gestão de rascunhos
 * - NfeBuilderService: Construção de payloads
 */
@Injectable()
export class NfeDraftService {
  private readonly logger = new Logger(NfeDraftService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Busca rascunho existente para uma ordem
   */
  async findDraftByOrderId(
    companyId: string,
    orderId: string,
  ): Promise<any | null> {
    return this.prisma.nfe.findFirst({
      where: {
        companyId,
        orderId,
        status: NfeStatus.DRAFT,
      },
    });
  }

  /**
   * Busca rascunho pelo ID
   */
  async findDraftById(companyId: string, draftId: string): Promise<any | null> {
    return this.prisma.nfe.findFirst({
      where: {
        id: draftId,
        companyId,
        status: NfeStatus.DRAFT,
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
      destinatario: draftData.destinatario || preparedData.destinatario,
      items: (draftData.items || preparedData.items).map((item: any) => {
        const preparedItem = preparedData.items.find(
          (pi: any) => pi.productId === item.productId,
        );
        return {
          ...item,
          isService: preparedItem?.isService || false,
        };
      }),
      transportadora: draftData.transportadora || preparedData.transportadora,
      volumes: draftData.volumes || preparedData.volumes,
      pagamento: draftData.pagamento || preparedData.pagamento,
      duplicatas: draftData.duplicatas || preparedData.duplicatas,
      autXml: draftData.autXml || preparedData.autXml,
      informacoesComplementares:
        draftData.informacoesComplementares ||
        preparedData.informacoesComplementares,
    };
  }

  /**
   * Cria um novo rascunho de NF-e
   */
  async createDraft(
    companyId: string,
    orderId: string,
    quotationId: string,
    preparedData: any,
    config: any,
  ): Promise<any> {
    if (!config) {
      throw new BadRequestException('Configuração do Invoicy não encontrada.');
    }

    const draft = await this.prisma.nfe.create({
      data: {
        companyId,
        orderId,
        quotationId,
        // Numeracao da linha ambiental (activeNumbering), nao da coluna global
        // de invoicy_configs: a reserva do emit le de la, e exibir o campo
        // legado mostrava um numero que nao seria emitido.
        numero: config.activeNumbering?.nfe?.nextNumber ?? 1,
        serie: config.activeNumbering?.nfe?.series ?? config.serieNfe ?? 1,
        status: NfeStatus.DRAFT,
        ambiente: config.ambiente || 2,
        valorTotal: preparedData.totais?.valorNota || 0,
        draftData: JSON.parse(
          JSON.stringify({
            destinatario: preparedData.destinatario,
            items: preparedData.items,
            transportadora: preparedData.transportadora,
            volumes: preparedData.volumes,
            pagamento: preparedData.pagamento,
            duplicatas: preparedData.duplicatas,
            autXml: preparedData.autXml,
            informacoesComplementares: preparedData.informacoesComplementares,
          }),
        ),
      },
    });

    this.logger.log(
      `Rascunho de NF-e criado: ${draft.id} para ordem ${orderId}`,
    );

    return {
      ...preparedData,
      draftId: draft.id,
      isDraft: true,
    };
  }

  /**
   * Atualiza os dados de um rascunho
   */
  async updateDraft(
    companyId: string,
    draftId: string,
    dto: UpdateNfeDraftDto,
  ): Promise<any> {
    const draft = await this.findDraftById(companyId, draftId);

    if (!draft) {
      throw new NotFoundException('Rascunho não encontrado');
    }

    const existingDraftData = (draft.draftData as Record<string, any>) || {};

    // Mesclar dados existentes com novos dados
    const updatedDraftData = {
      ...existingDraftData,
      ...(dto.destinatario && { destinatario: dto.destinatario }),
      ...(dto.items && { items: dto.items }),
      ...(dto.transportadora && { transportadora: dto.transportadora }),
      ...(dto.volumes && { volumes: dto.volumes }),
      ...(dto.pagamento && { pagamento: dto.pagamento }),
      ...(dto.duplicatas && { duplicatas: dto.duplicatas }),
      ...(dto.autXml && { autXml: dto.autXml }),
      ...(dto.informacoesComplementares !== undefined && {
        informacoesComplementares: dto.informacoesComplementares,
      }),
    };

    const updatedDraft = await this.prisma.nfe.update({
      where: { id: draftId },
      data: {
        draftData: JSON.parse(JSON.stringify(updatedDraftData)),
      },
    });

    this.logger.log(`Rascunho de NF-e atualizado: ${draftId}`);

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

    await this.prisma.nfe.delete({
      where: { id: draftId },
    });

    this.logger.log(`Rascunho de NF-e deletado: ${draftId}`);

    return {
      success: true,
      message: 'Rascunho deletado com sucesso',
    };
  }
}
