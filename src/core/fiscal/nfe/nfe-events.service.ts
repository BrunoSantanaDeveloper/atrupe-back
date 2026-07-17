import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { NfeStatus } from '@prisma/client';
import { InvoicyApiService } from '../invoicy/invoicy-api.service';
import {
  INVOICY_ERROR_CODES,
  INVOICY_SUCCESS_CODES,
} from '../invoicy/invoicy.types';
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
    if (
      nfe.status !== NfeStatus.AUTHORIZED &&
      nfe.status !== NfeStatus.CORRECTION_SENT
    ) {
      throw new BadRequestException(
        'Apenas NF-e autorizadas ou com carta de correção podem ser canceladas',
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
        nfe.ambiente,
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

      this.logger.log(
        `Resposta bruta Invoicy cancelamento NF-e ${nfe.numero}: ${JSON.stringify(response)}`,
      );

      const doc = response.Documentos?.[0];
      const situacao = doc?.Situacao;
      const isCancelled =
        situacao?.SitCodigo === 135 || situacao?.SitCodigo === 101;

      if (!isCancelled) {
        const mensagemSefaz =
          doc?.MensagemSefaz?.DscMsg ||
          situacao?.SitDescricao ||
          'Cancelamento não autorizado pela SEFAZ';
        throw new Error(mensagemSefaz);
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
    if (
      nfe.status !== NfeStatus.AUTHORIZED &&
      nfe.status !== NfeStatus.CORRECTION_SENT
    ) {
      throw new BadRequestException(
        'Cartas de correção só podem ser enviadas para NF-e autorizadas ou com correção anterior',
      );
    }

    const correcao = dto.correcao?.trim() || '';

    if (correcao.length < 15) {
      throw new BadRequestException(
        'O texto da correção deve ter no mínimo 15 caracteres',
      );
    }

    if (correcao.length > 1000) {
      throw new BadRequestException(
        'O texto da correção deve ter no máximo 1000 caracteres',
      );
    }

    if (!/^\d{44}$/.test(nfe.chaveAcesso || '')) {
      throw new BadRequestException(
        'A chave de acesso da NF-e deve conter exatamente 44 dígitos',
      );
    }

    try {
      this.logger.log(`Enviando carta de correção para NF-e ${nfe.numero}`);
      const ambienteEvento = this.resolveDocumentEnvironment(nfe);

      const updatedNfe = await this.prisma.$transaction(
        async (tx) => {
          // Lock pessimista da NF-e: evita duas CC-e concorrentes calcularem a mesma sequência.
          await tx.nfe.update({
            where: { id: nfe.id },
            data: { updatedAt: new Date() },
            select: { id: true },
          });

          const lastEvent = await tx.nfeCorrectionEvent.findFirst({
            where: { nfeId: nfe.id },
            orderBy: { sequenciaEvento: 'desc' },
          });
          const sequenciaEvento = lastEvent ? lastEvent.sequenciaEvento + 1 : 1;

          if (sequenciaEvento > 20) {
            throw new BadRequestException(
              'A sequência da carta de correção deve ser um número entre 1 e 20',
            );
          }

          const invoicyResponses =
            await this.invoicyApiService.sendCorrectionLetter(
              companyId,
              nfe.chaveAcesso,
              correcao,
              sequenciaEvento,
              ambienteEvento,
            );

          const response = invoicyResponses[0];
          if (!response) {
            throw new Error('Nenhuma resposta recebida do Invoicy');
          }

          if (response.Codigo !== INVOICY_SUCCESS_CODES.DOCUMENTS_PROCESSED) {
            throw new Error(
              this.getCorrectionRejectionMessage(
                response,
                nfe.chaveAcesso,
                sequenciaEvento,
                correcao.length,
                ambienteEvento,
              ),
            );
          }

          const doc = response.Documentos?.[0];
          const situacao = doc?.Situacao;
          const isApproved = situacao?.SitCodigo === 135;

          if (!isApproved) {
            throw new Error(
              this.getCorrectionRejectionMessage(
                response,
                nfe.chaveAcesso,
                sequenciaEvento,
                correcao.length,
                ambienteEvento,
              ),
            );
          }

          const xmlEvento = doc?.DocXMLBase64
            ? Buffer.from(doc.DocXMLBase64, 'base64').toString('utf-8')
            : null;

          if (!xmlEvento) {
            this.logger.warn(
              `XML da CC-e não retornado pela Invoicy para NF-e ${nfe.numero} (evento seq ${sequenciaEvento})`,
            );
          }

          const dataEvento = new Date();
          const persistedNfe = await tx.nfe.update({
            where: { id: nfe.id },
            data: {
              status: NfeStatus.CORRECTION_SENT,
              cartaCorrecao: correcao,
              dataCorrecao: dataEvento,
              protocoloCorrecao: doc?.DocProtocolo || null,
              sequenciaCorrecao: sequenciaEvento,
            },
          });

          await tx.nfeCorrectionEvent.create({
            data: {
              nfeId: nfe.id,
              sequenciaEvento,
              correcao,
              protocolo: doc?.DocProtocolo || null,
              dataEvento,
              xmlEvento,
            },
          });

          return persistedNfe;
        },
        { maxWait: 5000, timeout: 30000 },
      );

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

  private getCorrectionRejectionMessage(
    response: any,
    chaveAcesso: string,
    sequenciaEvento: number,
    correctionLength: number,
    ambiente?: number,
  ): string {
    const envLabel = ambiente === 1 ? 'produção' : 'homologação';
    const knownCodes: Record<number, string> = {
      [INVOICY_ERROR_CODES.COMPANY_NOT_ENABLED]:
        `A empresa emissora não está habilitada no Invoicy para o ambiente de ${envLabel}. ` +
        `Acesse Configurações → Emissores, selecione o emissor e conclua a ativação do ambiente de ${envLabel} para NF-e.`,
      [INVOICY_ERROR_CODES.INVALID_KEY]:
        'Chave de acesso da NF-e inválida. O documento pode ter sido emitido com dados inconsistentes.',
      [INVOICY_ERROR_CODES.REJECTED_BY_SEFAZ]:
        'A SEFAZ rejeitou o evento. Verifique os dados da NF-e e tente novamente.',
    };

    const code = response?.Codigo as number | undefined;

    const doc = response?.Documentos?.[0];
    const providerMessages = [
      response?.ErrorInvoicy,
      doc?.MensagemSefaz?.DscMsg,
      doc?.Situacao?.SitDescricao,
      response?.Mensagem,
      response?.Descricao,
    ]
      .filter((message): message is string =>
        Boolean(typeof message === 'string' && message.trim()),
      )
      .map((message) => message.trim());

    const genericMessage =
      'Não foi possível processar a operação, verifique os dados enviados e tente novamente.';
    const specificMessage = providerMessages.find(
      (message) => message !== genericMessage,
    );
    const codeStr = code ? ` (código ${code})` : '';

    if (specificMessage) {
      return `Carta de correção rejeitada${codeStr}: ${specificMessage}`;
    }

    if (code && knownCodes[code]) {
      return `Carta de correção rejeitada (código ${code}): ${knownCodes[code]}`;
    }

    return (
      `O Invoicy rejeitou a carta de correção${codeStr}, mas não informou qual campo está inválido. ` +
      `Dados enviados: chave de acesso ${chaveAcesso} (44 dígitos), ` +
      `sequência ${sequenciaEvento} e texto da correção com ${correctionLength} caracteres.`
    );
  }

  /**
   * O XML autorizado é a fonte fiscal de verdade para o ambiente. Algumas NF-e
   * legadas foram persistidas com `ambiente` divergente durante a troca de
   * homologação para produção, o que direcionava eventos ao endpoint incorreto.
   */
  private resolveDocumentEnvironment(nfe: any): number {
    const xmlCandidates = [
      nfe?.xmlAutorizado,
      nfe?.xmlRetorno,
      nfe?.xmlEnvio,
    ].filter((xml): xml is string => typeof xml === 'string' && xml.length > 0);

    for (const xmlCandidate of xmlCandidates) {
      const decodedCandidates = [xmlCandidate];
      try {
        decodedCandidates.push(
          Buffer.from(xmlCandidate, 'base64').toString('utf-8'),
        );
      } catch {
        // O conteúdo já pode estar em XML puro.
      }

      for (const xml of decodedCandidates) {
        const match = xml.match(/<tpAmb[^>]*>\s*([12])\s*<\/tpAmb>/i);
        if (match) {
          const xmlEnvironment = Number(match[1]);
          if (nfe?.ambiente !== xmlEnvironment) {
            this.logger.warn(
              `Ambiente divergente na NF-e ${nfe?.id}: banco=${nfe?.ambiente}, XML=${xmlEnvironment}. Usando o XML para o evento fiscal.`,
            );
          }
          return xmlEnvironment;
        }
      }
    }

    return nfe?.ambiente === 1 ? 1 : 2;
  }

  /**
   * Consulta status de uma NF-e
   */
  async consultStatus(nfe: any, companyId: string): Promise<any> {
    if (!nfe.chaveAcesso) {
      return {
        id: nfe.id,
        numero: nfe.numero,
        serie: nfe.serie,
        status: nfe.status,
        statusDescription: 'Chave de acesso não disponível para consulta',
        checkedAt: new Date().toISOString(),
      };
    }

    try {
      this.logger.log(`Consultando status real NF-e ${nfe.numero} na SEFAZ`);

      const invoicyResponses = await this.invoicyApiService.consultNfeSefaz(
        companyId,
        nfe.chaveAcesso,
      );

      const response = invoicyResponses[0];
      const doc = response?.Documentos?.[0];
      const situacao = doc?.Situacao;

      const newStatus = this.mapSefazCodToStatus(situacao?.SitCodigo);

      let updatedNfe = nfe;
      if (newStatus && newStatus !== nfe.status) {
        this.logger.log(
          `Status NF-e ${nfe.numero} mudou: ${nfe.status} → ${newStatus}`,
        );

        updatedNfe = await this.prisma.nfe.update({
          where: { id: nfe.id },
          data: { status: newStatus as any },
        });
      }

      return {
        id: updatedNfe.id,
        numero: updatedNfe.numero,
        serie: updatedNfe.serie,
        status: updatedNfe.status,
        statusChanged: newStatus !== nfe.status,
        sefazCode: situacao?.SitCodigo,
        sefazDescription: situacao?.SitDescricao,
        chaveAcesso: nfe.chaveAcesso,
        protocolo: nfe.protocolo,
        dataEmissao: nfe.dataEmissao,
        dataAutorizacao: nfe.dataAutorizacao,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(
        `Erro ao consultar status NF-e ${nfe.numero}: ${error.message}`,
        error.stack,
      );
      return {
        id: nfe.id,
        numero: nfe.numero,
        serie: nfe.serie,
        status: nfe.status,
        sefazError: error.message,
        checkedAt: new Date().toISOString(),
      };
    }
  }

  private mapSefazCodToStatus(sitCodigo?: number): string | null {
    if (!sitCodigo) return null;

    const map: Record<number, string> = {
      100: 'AUTHORIZED',
      101: 'CANCELLED',
      102: 'CANCELLED',
      135: 'CORRECTION_SENT',
      204: 'AUTHORIZED',
      217: 'REJECTED',
    };

    return map[sitCodigo] || null;
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
