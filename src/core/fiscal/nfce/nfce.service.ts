import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { NfceStatus } from '@prisma/client';
import { InvoicyService } from '../invoicy/invoicy.service';
import { InvoicyApiService } from '../invoicy/invoicy-api.service';
import {
  InvoicyNfeRequest,
  INVOICY_SUCCESS_CODES,
} from '../invoicy/invoicy.types';
import { fetchCepData } from '../utils/cep.util';
import {
  EmitNfceDto,
  CancelNfceDto,
  InutilizarNfceDto,
  ContingenciaNfceDto,
  NfceFilterDto,
} from './dtos/nfce.dto';

@Injectable()
export class NfceService {
  private readonly logger = new Logger(NfceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoicyService: InvoicyService,
    private readonly invoicyApiService: InvoicyApiService,
  ) {}

  async findAll(companyId: string, filters: NfceFilterDto) {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = { companyId };

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.numero) {
      where.numero = filters.numero;
    }

    if (filters.orderId) {
      where.orderId = filters.orderId;
    }

    if (filters.startDate || filters.endDate) {
      where.createdAt = {};
      if (filters.startDate) {
        where.createdAt.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        where.createdAt.lte = new Date(filters.endDate);
      }
    }

    const [items, total] = await Promise.all([
      this.prisma.nfce.findMany({
        where,
        skip,
        take: limit,
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
          quotation: {
            include: {
              client: true,
            },
          },
        },
      }),
      this.prisma.nfce.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findById(id: string, companyId: string) {
    const nfce = await this.prisma.nfce.findFirst({
      where: { id, companyId },
      include: {
        order: {
          include: {
            quotation: {
              include: {
                client: true,
                quotationProduct: {
                  include: {
                    product: true,
                  },
                },
              },
            },
          },
        },
        quotation: {
          include: {
            client: true,
            quotationProduct: {
              include: {
                product: true,
              },
            },
          },
        },
      },
    });

    if (!nfce) {
      throw new NotFoundException('NFC-e não encontrada');
    }

    return nfce;
  }

  async findByChaveAcesso(chaveAcesso: string, companyId: string) {
    const nfce = await this.prisma.nfce.findFirst({
      where: { chaveAcesso, companyId },
    });

    if (!nfce) {
      throw new NotFoundException('NFC-e não encontrada');
    }

    return nfce;
  }

  async emit(companyId: string, dto: EmitNfceDto) {
    // Buscar configuração do Invoicy
    const config = await this.invoicyService.getConfig(companyId);
    if (!config) {
      throw new BadRequestException(
        'Configuração do Invoicy não encontrada. Configure a integração primeiro.',
      );
    }

    if (!config.isActive) {
      throw new BadRequestException('Integração com Invoicy está desativada.');
    }

    // Obter próximo número da NFC-e (sem incrementar ainda - só incrementa após emissão bem-sucedida)
    const numero = config.proximoNumeroNfce || 1;

    // Calcular valor total
    const valorTotal = dto.itens.reduce((acc, item) => {
      const valorItem = item.quantidade * item.valorUnitario;
      return acc + valorItem - (item.valorDesconto || 0);
    }, 0);

    // Calcular valor dos pagamentos
    const valorPagamentos = dto.pagamentos.reduce(
      (acc, pag) => acc + pag.valor,
      0,
    );

    // Validar pagamentos
    if (Math.abs(valorPagamentos - valorTotal) > 0.01 && !dto.valorTroco) {
      throw new BadRequestException(
        'Valor dos pagamentos deve ser igual ao valor total ou incluir troco',
      );
    }

    // Criar registro da NFC-e
    const nfce = await this.prisma.nfce.create({
      data: {
        companyId,
        orderId: dto.orderId,
        quotationId: dto.quotationId,
        numero,
        serie: config.serieNfce || 1,
        status: NfceStatus.PROCESSING,
        ambiente: config.ambiente,
        valorTotal,
        valorDesconto: dto.itens.reduce(
          (acc, item) => acc + (item.valorDesconto || 0),
          0,
        ),
        valorTroco: dto.valorTroco || 0,
        formaPagamento: dto.pagamentos[0]?.tipo || '01',
      },
    });

    try {
      this.logger.log(`Emitindo NFC-e ${numero} para empresa ${companyId}`);

      // Ensure we have emitter IBGE code
      let emitCmun = config.ibgeCode;
      const emitCep = config.company?.address?.zipcode;

      if (!emitCmun && emitCep) {
        this.logger.log(
          `Emitente (Empresa) sem código IBGE configurado. Buscando via CEP do emitente: ${emitCep}`,
        );
        const cepData = await fetchCepData(emitCep);
        if (cepData) {
          emitCmun = cepData.codigoIbge;
          this.logger.log(`IBGE do emitente encontrado: ${emitCmun}`);
        } else {
          this.logger.warn(
            `Não foi possível encontrar IBGE para CEP do emitente: ${emitCep}`,
          );
        }
      }

      // Construir payload para o Invoicy (NFC-e usa modelo 65)
      const now = new Date();
      const invoicyRequest: InvoicyNfeRequest = {
        Documento: {
          ModeloDocumento: 'NFCe',
          Versao: 4,
          ide: {
            cUF: this.getUfCode(config.company.address.state),
            natOp: 'Venda de mercadoria',
            mod: '65',
            serie: (config.serieNfce || 1).toString(),
            nNF: numero,
            dhEmi: now.toISOString(),
            fusoHorario: '-03:00',
            tpNf: 1, // Saída
            idDest: 1, // Operação interna
            cMunFg: parseInt(emitCmun || '0', 10),
            tpImp: 4, // DANFE NFC-e
            tpEmis: 1, // Emissão normal
            cDV: 0,
            tpAmb: config.ambiente === 'PRODUCAO' ? 1 : 2,
            finNFe: 1,
            indFinal: 1, // Consumidor final
            indPres: 1, // Presença do comprador
            procEmi: 0,
            verProc: 'Atrupe 1.0',
          },
          emit: {
            CNPJ_emit: (config.company.cnpj || '').replace(/\D/g, ''),
            xNome: config.company.legalName || '',
            IE: (config.company.stateRegistration || '').replace(/\D/g, ''),
            CRT: config.emitCrt || 1,
            enderEmit: {
              xLgr: config.company.address.street || '',
              nro: config.company.address.number || 'S/N',
              xBairro: config.company.address.neighborhood || '',
              cMun: parseInt(emitCmun || '0', 10),
              xMun: '', // Empty for NFC-e sometimes? Or use emitXMun?
              UF: config.company.address.state || '',
              CEP:
                parseInt(
                  (config.company.address.zipcode || '').replace(/\D/g, ''),
                  10,
                ) || 0,
            },
          },
          dest: {
            xNome_dest: dto.consumidorNome || 'CONSUMIDOR NAO IDENTIFICADO',
            indIEDest: 9,
            enderDest: {
              xLgr_dest: '',
              nro_dest: '',
              xBairro_dest: '',
              cMun_dest: 0,
              xMun_dest: '',
              UF_dest: config.company.address.state || '',
              CEP_dest: 0,
              cPais_dest: 1058,
            },
          },
          det: dto.itens.map((item, index) => ({
            prod: {
              cProd: item.codigo || `ITEM${index + 1}`,
              cEAN: 'SEM GTIN',
              cEANTrib: 'SEM GTIN',
              xProd: item.descricao || `Produto ${index + 1}`,
              NCM: item.ncm || '00000000',
              CFOP: item.cfop ? Number(item.cfop) : 5102,
              uCOM: item.unidade || 'UN',
              qCOM: item.quantidade.toFixed(4),
              vUnCom: item.valorUnitario.toFixed(10),
              vProd: (item.quantidade * item.valorUnitario).toFixed(2),
              uTrib: item.unidade || 'UN',
              qTrib: item.quantidade.toFixed(4),
              vUnTrib: item.valorUnitario.toFixed(10),
              indTot: 1,
            },
            imposto: {
              ICMS: {
                orig: 0,
                CST: '102',
              },
              PIS: {
                CST_pis: '49',
              },
              COFINS: {
                CST_cofins: '49',
              },
            },
          })),
          total: {
            ICMStot: {
              vBC_ttlnfe: '0.00',
              vICMS_ttlnfe: '0.00',
              vICMSDeson_ttlnfe: '0.00',
              vBCST_ttlnfe: '0.00',
              vProd_ttlnfe: valorTotal.toFixed(2),
              vFrete_ttlnfe: '0.00',
              vSeg_ttlnfe: '0.00',
              vDesc_ttlnfe: dto.itens
                .reduce((acc, i) => acc + (i.valorDesconto || 0), 0)
                .toFixed(2),
              vII_ttlnfe: '0.00',
              vIPI_ttlnfe: '0.00',
              vPIS_ttlnfe: '0.00',
              vCOFINS_ttlnfe: '0.00',
              vOutro: '0.00',
              vNF: valorTotal.toFixed(2),
            },
          },
          pag: dto.pagamentos.map((pag) => ({
            tPag: pag.tipo,
            vPag: pag.valor.toFixed(2),
          })),
          transp: {
            modFrete: '9',
          },
        },
      };

      // Chamar API do Invoicy
      const invoicyResponses = await this.invoicyApiService.emitNfe(companyId, [
        invoicyRequest,
      ]);

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
      if (!doc) {
        throw new Error('Documento não retornado pelo Invoicy');
      }

      const situacao = doc.Situacao;
      const isAuthorized =
        situacao?.SitCodigo === 100 || situacao?.SitCodigo === 150;

      // Atualizar NFC-e com resposta
      const updatedNfce = await this.prisma.nfce.update({
        where: { id: nfce.id },
        data: {
          status: isAuthorized ? NfceStatus.AUTHORIZED : NfceStatus.REJECTED,
          chaveAcesso: doc.DocChaAcesso || null,
          protocolo: doc.DocProtocolo || null,
          invoicyId: doc.DocIDUnico || null,
          invoicyProtocol: doc.DocProtocolo || null,
          dataEmissao: new Date(),
          dataAutorizacao: isAuthorized ? new Date() : null,
          qrCodeUrl: doc.DocCompleto || null, // URL do QR Code
          urlConsulta: doc.DocPDFDownload || null,
          danfeUrl: doc.DocPDFDownload || null,
          xmlAutorizado: doc.DocXMLBase64
            ? Buffer.from(doc.DocXMLBase64, 'base64').toString('utf-8')
            : null,
          motivoRejeicao: !isAuthorized ? situacao?.SitDescricao : null,
        },
      });

      if (!isAuthorized) {
        throw new BadRequestException(
          `NFC-e rejeitada: ${situacao?.SitDescricao || 'Motivo desconhecido'}`,
        );
      }

      // Incrementar número da NFC-e somente após emissão bem-sucedida
      await this.invoicyService.incrementNfceNumber(config.id);

      return updatedNfce;
    } catch (error) {
      // Atualizar status para rejeitado em caso de erro
      await this.prisma.nfce.update({
        where: { id: nfce.id },
        data: {
          status: NfceStatus.REJECTED,
          motivoRejeicao: error.message,
        },
      });

      this.logger.error(`Erro ao emitir NFC-e: ${error.message}`, error.stack);
      throw new BadRequestException(`Erro ao emitir NFC-e: ${error.message}`);
    }
  }

  /**
   * Helper method to get UF numeric code
   */
  private getUfCode(uf: string): number {
    const ufCodes: Record<string, number> = {
      RO: 11,
      AC: 12,
      AM: 13,
      RR: 14,
      PA: 15,
      AP: 16,
      TO: 17,
      MA: 21,
      PI: 22,
      CE: 23,
      RN: 24,
      PB: 25,
      PE: 26,
      AL: 27,
      SE: 28,
      BA: 29,
      MG: 31,
      ES: 32,
      RJ: 33,
      SP: 35,
      PR: 41,
      SC: 42,
      RS: 43,
      MS: 50,
      MT: 51,
      GO: 52,
      DF: 53,
    };
    return ufCodes[uf?.toUpperCase()] || 43;
  }

  async cancel(id: string, companyId: string, dto: CancelNfceDto) {
    const nfce = await this.findById(id, companyId);

    if (nfce.status !== NfceStatus.AUTHORIZED) {
      throw new BadRequestException(
        'Apenas NFC-e autorizadas podem ser canceladas',
      );
    }

    if (dto.justificativa.length < 15) {
      throw new BadRequestException(
        'A justificativa deve ter no mínimo 15 caracteres',
      );
    }

    // Verificar se está dentro do prazo (30 minutos para NFC-e em alguns estados)
    const minutosDaEmissao =
      (Date.now() - new Date(nfce.dataEmissao).getTime()) / (1000 * 60);
    if (minutosDaEmissao > 30) {
      throw new BadRequestException(
        'O prazo para cancelamento de NFC-e foi excedido (30 minutos)',
      );
    }

    try {
      this.logger.log(
        `Cancelando NFC-e ${nfce.numero} para empresa ${companyId}`,
      );

      // Chamar API do Invoicy para cancelamento (NFC-e usa mesmo endpoint que NF-e)
      const invoicyResponses = await this.invoicyApiService.cancelNfe(
        companyId,
        nfce.chaveAcesso,
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

      const updatedNfce = await this.prisma.nfce.update({
        where: { id },
        data: {
          status: NfceStatus.CANCELLED,
          motivoCancelamento: dto.justificativa,
          dataCancelamento: new Date(),
          protocoloCancelamento: doc?.DocProtocolo || null,
        },
      });

      return updatedNfce;
    } catch (error) {
      this.logger.error(
        `Erro ao cancelar NFC-e: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(`Erro ao cancelar NFC-e: ${error.message}`);
    }
  }

  async inutilizar(companyId: string, dto: InutilizarNfceDto) {
    const config = await this.invoicyService.getConfig(companyId);
    if (!config) {
      throw new BadRequestException('Configuração do Invoicy não encontrada.');
    }

    if (dto.justificativa.length < 15) {
      throw new BadRequestException(
        'A justificativa deve ter no mínimo 15 caracteres',
      );
    }

    if (dto.numeroInicial > dto.numeroFinal) {
      throw new BadRequestException(
        'Número inicial deve ser menor ou igual ao número final',
      );
    }

    try {
      this.logger.log(
        `Inutilizando NFC-e ${dto.numeroInicial} a ${dto.numeroFinal} para empresa ${companyId}`,
      );

      // Chamar API do Invoicy para inutilização
      const invoicyResponses = await this.invoicyApiService.inutilizarNfce(
        companyId,
        config.serieNfce || 1,
        dto.numeroInicial,
        dto.numeroFinal,
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
      const isInutilized = situacao?.SitCodigo === 102;

      if (!isInutilized) {
        throw new Error(
          situacao?.SitDescricao || 'Inutilização não autorizada pela SEFAZ',
        );
      }

      return {
        success: true,
        message: `Numeração ${dto.numeroInicial} a ${dto.numeroFinal} inutilizada com sucesso`,
        numeroInicial: dto.numeroInicial,
        numeroFinal: dto.numeroFinal,
        protocolo: doc?.DocProtocolo || null,
      };
    } catch (error) {
      this.logger.error(
        `Erro ao inutilizar NFC-e: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(
        `Erro ao inutilizar NFC-e: ${error.message}`,
      );
    }
  }

  async toggleContingencia(companyId: string, dto: ContingenciaNfceDto) {
    const config = await this.invoicyService.getConfig(companyId);
    if (!config) {
      throw new BadRequestException('Configuração do Invoicy não encontrada.');
    }

    // TODO: Implementar lógica de contingência
    this.logger.log(
      `${dto.ativar ? 'Ativando' : 'Desativando'} contingência para empresa ${companyId}`,
    );

    return {
      success: true,
      contingenciaAtiva: dto.ativar,
      motivo: dto.motivo,
      dataHora: new Date(),
    };
  }

  async consultStatus(id: string, companyId: string) {
    const nfce = await this.findById(id, companyId);

    try {
      // TODO: Implementar consulta real ao status da NFC-e na SEFAZ via Invoicy
      this.logger.log(`Consultando status da NFC-e ${nfce.numero}`);

      return {
        id: nfce.id,
        numero: nfce.numero,
        serie: nfce.serie,
        status: nfce.status,
        chaveAcesso: nfce.chaveAcesso,
        protocolo: nfce.protocolo,
        dataEmissao: nfce.dataEmissao,
        dataAutorizacao: nfce.dataAutorizacao,
        valorTotal: nfce.valorTotal,
      };
    } catch (error) {
      this.logger.error(
        `Erro ao consultar status da NFC-e: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(
        `Erro ao consultar status da NFC-e: ${error.message}`,
      );
    }
  }

  async getDanfeUrl(id: string, companyId: string) {
    const nfce = await this.findById(id, companyId);

    if (!nfce.danfeUrl) {
      // TODO: Buscar DANFE da API do Invoicy se não estiver armazenado
      throw new NotFoundException('DANFE não disponível para esta NFC-e');
    }

    return { url: nfce.danfeUrl };
  }

  async getXml(id: string, companyId: string) {
    const nfce = await this.findById(id, companyId);

    if (!nfce.xmlAutorizado) {
      // TODO: Buscar XML da API do Invoicy se não estiver armazenado
      throw new NotFoundException('XML não disponível para esta NFC-e');
    }

    return { xml: nfce.xmlAutorizado };
  }

  async getQrCode(id: string, companyId: string) {
    const nfce = await this.findById(id, companyId);

    if (!nfce.qrCodeUrl) {
      throw new NotFoundException('QR Code não disponível para esta NFC-e');
    }

    return { url: nfce.qrCodeUrl };
  }
}
