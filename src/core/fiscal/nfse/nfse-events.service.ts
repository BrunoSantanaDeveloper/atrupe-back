import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { NfseStatus } from '@prisma/client';
import { InvoicyApiService } from '../invoicy/invoicy-api.service';
import { INVOICY_SUCCESS_CODES } from '../invoicy/invoicy.types';
import { CancelNfseDto } from './dtos/nfse.dto';

/**
 * NfseEventsService - Eventos pós-emissão de NFS-e
 *
 * Responsável por eventos fiscais após a emissão:
 * - Cancelamento de NFS-e
 * - Consulta de status
 * - Acesso a PDF/XML
 */
@Injectable()
export class NfseEventsService {
  private readonly logger = new Logger(NfseEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoicyApiService: InvoicyApiService,
  ) {}

  /**
   * Cancela uma NFS-e autorizada
   */
  async cancel(nfse: any, companyId: string, dto: CancelNfseDto): Promise<any> {
    if (nfse.status !== NfseStatus.AUTHORIZED) {
      throw new BadRequestException(
        'Apenas NFS-e autorizadas podem ser canceladas',
      );
    }

    if (dto.justificativa.length < 15) {
      throw new BadRequestException(
        'A justificativa deve ter no mínimo 15 caracteres',
      );
    }

    try {
      this.logger.log(
        `Cancelando NFS-e ${nfse.numero} para empresa ${companyId}`,
      );

      // Chamar API do Invoicy para cancelamento de NFS-e
      const invoicyResponses = await this.invoicyApiService.cancelNfse(
        companyId,
        nfse.numero,
        nfse.codigoVerificacao,
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
      const isCancelled = situacao?.SitCodigo === 101; // Cancelamento autorizado

      if (!isCancelled) {
        throw new Error(
          situacao?.SitDescricao ||
            'Cancelamento não autorizado pela Prefeitura',
        );
      }

      const updatedNfse = await this.prisma.nfse.update({
        where: { id: nfse.id },
        data: {
          status: NfseStatus.CANCELLED,
          motivoCancelamento: dto.justificativa,
          dataCancelamento: new Date(),
          protocoloCancelamento: doc?.DocProtocolo || null,
        },
      });

      return updatedNfse;
    } catch (error) {
      this.logger.error(
        `Erro ao cancelar NFS-e: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(`Erro ao cancelar NFS-e: ${error.message}`);
    }
  }

  /**
   * Consulta status de uma NFS-e
   */
  consultStatus(nfse: any): any {
    // TODO: Implementar consulta real ao status da NFS-e na prefeitura via Invoicy
    this.logger.log(`Consultando status da NFS-e ${nfse.numero}`);

    return {
      id: nfse.id,
      numero: nfse.numero,
      serie: nfse.serie,
      rpsNumero: nfse.rpsNumero,
      rpsSerie: nfse.rpsSerie,
      status: nfse.status,
      codigoVerificacao: nfse.codigoVerificacao,
      protocolo: nfse.protocolo,
      dataEmissao: nfse.dataEmissao,
      valorServicos: nfse.valorServicos,
    };
  }

  /**
   * Obtém URL do PDF
   */
  getPdfUrl(nfse: any): { url: string } {
    if (!nfse.pdfUrl) {
      throw new NotFoundException('PDF não disponível para esta NFS-e');
    }
    return { url: nfse.pdfUrl };
  }

  /**
   * Obtém XML de retorno, já fora do base64 em que o provedor o devolve
   * (ver NfseService.getXml, que é o caminho usado pela rota).
   */
  getXml(nfse: any): { xml: string } {
    if (!nfse.xmlRetorno) {
      throw new NotFoundException('XML não disponível para esta NFS-e');
    }

    const texto = String(nfse.xmlRetorno).trim();
    if (texto.startsWith('<')) return { xml: nfse.xmlRetorno };

    const decodificado = Buffer.from(texto, 'base64').toString('utf-8');
    return {
      xml: decodificado.trimStart().startsWith('<')
        ? decodificado
        : nfse.xmlRetorno,
    };
  }
}
