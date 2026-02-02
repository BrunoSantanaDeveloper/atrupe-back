import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { NfeStatus } from '@prisma/client';
import { InvoicyApiService } from '../invoicy/invoicy-api.service';
import { INVOICY_SUCCESS_CODES } from '../invoicy/invoicy.types';
import { CancelNfeDto, CorrectionLetterDto } from './dtos/nfe.dto';

/**
 * NfeEventsService - Eventos pós-emissão de NF-e
 *
 * Este service é responsável por eventos fiscais após a emissão:
 * - Cancelamento de NF-e
 * - Carta de Correção Eletrônica (CC-e)
 * - Consulta de status
 *
 * Separação de responsabilidades:
 * - NfeService: Orquestração e emissão
 * - NfeEventsService: Eventos pós-emissão
 * - NfeDraftService: Gestão de rascunhos
 * - NfeBuilderService: Construção de payloads
 */
@Injectable()
export class NfeEventsService {
  private readonly logger = new Logger(NfeEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoicyApiService: InvoicyApiService,
  ) {}

  /**
   * Cancela uma NF-e autorizada
   */
  async cancel(nfe: any, companyId: string, dto: CancelNfeDto): Promise<any> {
    if (nfe.status !== NfeStatus.AUTHORIZED) {
      throw new BadRequestException(
        'Apenas NF-e autorizadas podem ser canceladas',
      );
    }

    if (dto.justificativa.length < 15) {
      throw new BadRequestException(
        'A justificativa deve ter no mínimo 15 caracteres',
      );
    }

    // Verificar se está dentro do prazo (24h)
    const horasDaEmissao =
      (Date.now() - new Date(nfe.dataEmissao).getTime()) / (1000 * 60 * 60);
    if (horasDaEmissao > 24) {
      throw new BadRequestException(
        'O prazo para cancelamento de 24 horas foi excedido',
      );
    }

    try {
      this.logger.log(
        `Cancelando NF-e ${nfe.numero} para empresa ${companyId}`,
      );

      // Chamar API do Invoicy para cancelamento
      const invoicyResponses = await this.invoicyApiService.cancelNfe(
        companyId,
        nfe.chaveAcesso,
        dto.justificativa,
      );

      // Processar resposta
      const response = invoicyResponses[0];
      if (!response) {
        throw new Error('Nenhuma resposta recebida do Invoicy');
      }

      if (response.Codigo !== INVOICY_SUCCESS_CODES.DOCUMENTS_PROCESSED) {
        throw new Error(
          response.Descricao || `Erro Invoicy: código ${response.Codigo}`,
        );
      }

      const doc = response.Documentos?.[0];
      const situacao = doc?.Situacao;
      const isCancelled =
        situacao?.SitCodigo === 135 || situacao?.SitCodigo === 101;

      if (!isCancelled) {
        throw new Error(
          situacao?.SitDescricao || 'Cancelamento não autorizado pela SEFAZ',
        );
      }

      const updatedNfe = await this.prisma.nfe.update({
        where: { id: nfe.id },
        data: {
          status: NfeStatus.CANCELLED,
          motivoCancelamento: dto.justificativa,
          dataCancelamento: new Date(),
          protocoloCancelamento: doc?.DocProtocolo || null,
        },
      });

      return updatedNfe;
    } catch (error) {
      this.logger.error(`Erro ao cancelar NF-e: ${error.message}`, error.stack);
      throw new BadRequestException(`Erro ao cancelar NF-e: ${error.message}`);
    }
  }

  /**
   * Envia carta de correção eletrônica (CC-e)
   */
  async sendCorrectionLetter(
    nfe: any,
    companyId: string,
    dto: CorrectionLetterDto,
  ): Promise<any> {
    if (nfe.status !== NfeStatus.AUTHORIZED) {
      throw new BadRequestException(
        'Cartas de correção só podem ser enviadas para NF-e autorizadas',
      );
    }

    if (dto.correcao.length < 15) {
      throw new BadRequestException(
        'O texto da correção deve ter no mínimo 15 caracteres',
      );
    }

    try {
      this.logger.log(`Enviando carta de correção para NF-e ${nfe.numero}`);

      // Obter sequência do evento (max 20 cartas de correção por NF-e)
      const sequenciaEvento = dto.sequenciaEvento || 1;

      // Chamar API do Invoicy para carta de correção
      const invoicyResponses =
        await this.invoicyApiService.sendCorrectionLetter(
          companyId,
          nfe.chaveAcesso,
          dto.correcao,
          sequenciaEvento,
        );

      // Processar resposta
      const response = invoicyResponses[0];
      if (!response) {
        throw new Error('Nenhuma resposta recebida do Invoicy');
      }

      if (response.Codigo !== INVOICY_SUCCESS_CODES.DOCUMENTS_PROCESSED) {
        throw new Error(
          response.Descricao || `Erro Invoicy: código ${response.Codigo}`,
        );
      }

      const doc = response.Documentos?.[0];
      const situacao = doc?.Situacao;
      const isApproved = situacao?.SitCodigo === 135;

      if (!isApproved) {
        throw new Error(
          situacao?.SitDescricao ||
            'Carta de correção não autorizada pela SEFAZ',
        );
      }

      const updatedNfe = await this.prisma.nfe.update({
        where: { id: nfe.id },
        data: {
          status: NfeStatus.CORRECTION_SENT,
          cartaCorrecao: dto.correcao,
          dataCorrecao: new Date(),
          protocoloCorrecao: doc?.DocProtocolo || null,
          sequenciaCorrecao: sequenciaEvento,
        },
      });

      return updatedNfe;
    } catch (error) {
      this.logger.error(
        `Erro ao enviar carta de correção: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(
        `Erro ao enviar carta de correção: ${error.message}`,
      );
    }
  }

  /**
   * Consulta status de uma NF-e
   */
  async consultStatus(nfe: any): Promise<any> {
    try {
      // TODO: Implementar consulta real ao status da NF-e na SEFAZ via Invoicy
      this.logger.log(`Consultando status da NF-e ${nfe.numero}`);

      return {
        id: nfe.id,
        numero: nfe.numero,
        serie: nfe.serie,
        status: nfe.status,
        chaveAcesso: nfe.chaveAcesso,
        protocolo: nfe.protocolo,
        dataEmissao: nfe.dataEmissao,
        dataAutorizacao: nfe.dataAutorizacao,
      };
    } catch (error) {
      this.logger.error(
        `Erro ao consultar status da NF-e: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(
        `Erro ao consultar status da NF-e: ${error.message}`,
      );
    }
  }

  /**
   * Obtém URL do DANFE
   */
  getDanfeUrl(nfe: any): { url: string } {
    if (!nfe.danfeUrl) {
      throw new NotFoundException('DANFE não disponível para esta NF-e');
    }
    return { url: nfe.danfeUrl };
  }

  /**
   * Obtém XML autorizado
   */
  getXml(nfe: any): { xml: string } {
    if (!nfe.xmlAutorizado) {
      throw new NotFoundException('XML não disponível para esta NF-e');
    }
    return { xml: nfe.xmlAutorizado };
  }
}
