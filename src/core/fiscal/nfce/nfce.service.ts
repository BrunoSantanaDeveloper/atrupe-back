import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
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
import { FiscalCredentialResolverService } from '../shared/fiscal-credential-resolver.service';

@Injectable()
export class NfceService {
  private readonly logger = new Logger(NfceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoicyService: InvoicyService,
    private readonly invoicyApiService: InvoicyApiService,
    private readonly fiscalCredentialResolver: FiscalCredentialResolverService,
  ) {}

  async prepareStandalone(companyId: string) {
    const config = await this.invoicyService.getConfig(companyId);
    if (!config) {
      throw new BadRequestException(
        'Configuração do Invoicy não encontrada. Configure a integração primeiro.',
      );
    }
    const environment =
      await this.fiscalCredentialResolver.resolveOperationalEnvironment(
        companyId,
        config.id,
        'NFCE',
      );
    await this.fiscalCredentialResolver.assertEnvironmentReady(
      config.id,
      environment,
      'NFCE',
    );
    const credentials =
      await this.fiscalCredentialResolver.getEmissorRuntimeCredentials(
        companyId,
        config.id,
        environment,
      );

    return {
      numero: credentials.nfceNextNumber || 1,
      serie: credentials.nfceSeries || 1,
      ambiente: environment, // 'HOMOLOGACAO' ou 'PRODUCAO'
      emitCrt: config.emitCrt || 1,
      naturezaOperacao: 'Venda de mercadoria',
      informacoesComplementares: config.taxInfoText || '',
      prazoCancelamentoMinutos: config.prazoCancelamentoNfce ?? 30,
    };
  }

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

    const environment =
      await this.fiscalCredentialResolver.resolveOperationalEnvironment(
        companyId,
        config.id,
        'NFCE',
      );
    await this.fiscalCredentialResolver.assertEnvironmentReady(
      config.id,
      environment,
      'NFCE',
    );
    const emissorCredentials =
      await this.fiscalCredentialResolver.getEmissorRuntimeCredentials(
        companyId,
        config.id,
        environment,
      );

    // Guard: CSC obrigatório
    if (!emissorCredentials.cscId || !emissorCredentials.cscToken) {
      throw new BadRequestException(
        'CSC da NFC-e não configurado. Informe o ID do CSC e o Token CSC no emissor fiscal antes de emitir NFC-e.',
      );
    }

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

    // Guard: IBGE code obrigatório (antes de reservar número)
    let emitCmun = config.ibgeCode;
    if (!emitCmun && config.company?.address?.zipcode) {
      const cepData = await fetchCepData(config.company.address.zipcode);
      if (cepData) {
        emitCmun = cepData.codigoIbge;
      }
    }
    const parsedCmun = parseInt(emitCmun || '0', 10);
    if (!parsedCmun) {
      throw new BadRequestException(
        'Código IBGE do município do emitente não configurado ou inválido. ' +
          'Configure o código no emissor ou aguarde que o check de readiness retorne PASS.',
      );
    }

    const isContingency = !!config.contingenciaNfceAtiva;

    // Buscar dados fiscais dos produtos (antes da transação)
    const productIds = dto.itens.map((item) => item.productId).filter(Boolean);
    const fiscalDataList = await this.prisma.productFiscalData.findMany({
      where: { productId: { in: productIds } },
    });
    const fiscalDataMap = new Map(
      fiscalDataList.map((fd) => [fd.productId, fd]),
    );

    // TRANSAÇÃO ATÔMICA: Reservar número + criar registro NFC-e
    const { nfce, invoicyRequest } = await this.prisma.$transaction(
      async (tx) => {
        const { reservedNumber, series } =
          await this.fiscalCredentialResolver.reserveNfceNumber(
            tx,
            config.id,
            environment,
          );

        // Construir payload para o Invoicy (NFC-e usa modelo 65)
        const now = new Date();
        const consumidorDoc = (dto.cpfConsumidor || '').replace(/\D/g, '');
        const dest =
          consumidorDoc.length === 11 || consumidorDoc.length === 14
            ? {
                ...(consumidorDoc.length === 14
                  ? { CNPJ_dest: consumidorDoc }
                  : { CPF_dest: consumidorDoc }),
                xNome_dest: dto.consumidorNome || 'CONSUMIDOR',
                indIEDest: 9,
              }
            : undefined;

        // IE: ISENTO ou dígitos
        const rawIe = (config.company.stateRegistration || '').trim();
        const emitIe =
          rawIe.toUpperCase() === 'ISENTO'
            ? 'ISENTO'
            : rawIe.replace(/\D/g, '');

        const invoicyRequest: InvoicyNfeRequest = {
          Documento: {
            ModeloDocumento: 'NFCe',
            Versao: 4,
            ide: {
              cUF: this.getUfCode(config.company.address.state),
              natOp: dto.naturezaOperacao || 'Venda de mercadoria',
              mod: '65',
              serie: series.toString(),
              nNF: reservedNumber,
              dhEmi: now.toISOString(),
              fusoHorario: '-03:00',
              tpNf: 1, // Saída
              idDest: 1, // Operação interna
              cMunFg: parsedCmun,
              tpImp: 4, // DANFE NFC-e
              tpEmis: isContingency ? 9 : 1, // 1=Normal, 9=Contingência Off-line
              cDV: 0,
              tpAmb: environment === 'PRODUCAO' ? 1 : 2,
              finNFe: 1,
              indFinal: 1, // Consumidor final
              indPres: 1, // Presença do comprador
              procEmi: 0,
              verProc: 'Atrupe 1.0',
              idCSC: emissorCredentials.cscId
                ? parseInt(emissorCredentials.cscId, 10)
                : undefined,
              CSC: emissorCredentials.cscToken || undefined,
              ...(isContingency
                ? {
                    dhCont: (
                      config.contingenciaNfceDataHora || now
                    ).toISOString(),
                    xJust:
                      config.contingenciaNfceMotivo ||
                      'Problemas tecnicos de conexao',
                  }
                : {}),
            },
            emit: {
              CNPJ_emit: (config.company.cnpj || '').replace(/\D/g, ''),
              xNome: config.company.legalName || '',
              IE: emitIe || undefined,
              CRT: config.emitCrt || 1,
              enderEmit: {
                xLgr: config.company.address.street || '',
                nro: config.company.address.number || 'S/N',
                xBairro: config.company.address.neighborhood || '',
                cMun: parsedCmun,
                xMun: config.company.address.city || '',
                UF: config.company.address.state || '',
                CEP:
                  parseInt(
                    (config.company.address.zipcode || '').replace(/\D/g, ''),
                    10,
                  ) || 0,
              },
            },
            ...(dest ? { dest } : {}),
            det: dto.itens.map((item, index) => {
              const fiscalData = item.productId
                ? fiscalDataMap.get(item.productId)
                : null;

              const orig =
                item.icmsOrigem !== undefined && item.icmsOrigem !== null
                  ? parseInt(item.icmsOrigem, 10)
                  : fiscalData?.icmsOrigin
                    ? parseInt(fiscalData.icmsOrigin, 10)
                    : 0;

              const icmsCst = item.icmsCst || fiscalData?.icmsCst || '102';
              const pisCst = item.pisCst || fiscalData?.pisCst || '49';
              const cofinsCst = item.cofinsCst || fiscalData?.cofinsCst || '49';

              return {
                prod: {
                  cProd: item.codigo || `ITEM${index + 1}`,
                  cEAN: item.cean || fiscalData?.cean || 'SEM GTIN',
                  cEANTrib: item.cean || fiscalData?.cean || 'SEM GTIN',
                  xProd: item.descricao || `Produto ${index + 1}`,
                  NCM: (item.ncm || fiscalData?.ncm || '00000000').replace(
                    /\D/g,
                    '',
                  ),
                  CEST: item.cest || fiscalData?.cest || undefined,
                  CFOP: item.cfop
                    ? Number(item.cfop)
                    : fiscalData?.cfopInState
                      ? Number(fiscalData.cfopInState)
                      : 5102,
                  uCOM: item.unidade || fiscalData?.commercialUnit || 'UN',
                  qCOM: item.quantidade.toFixed(4),
                  vUnCom: item.valorUnitario.toFixed(10),
                  vProd: (item.quantidade * item.valorUnitario).toFixed(2),
                  uTrib: item.unidade || fiscalData?.commercialUnit || 'UN',
                  qTrib: item.quantidade.toFixed(4),
                  vUnTrib: item.valorUnitario.toFixed(10),
                  indTot: 1,
                },
                imposto: {
                  ICMS: {
                    orig,
                    CST: icmsCst,
                  },
                  PIS: {
                    CST_pis: pisCst,
                  },
                  COFINS: {
                    CST_cofins: cofinsCst,
                  },
                },
              };
            }),
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

        // Criar registro da NFC-e (numero já reservado atomicamente)
        const nfce = await tx.nfce.create({
          data: {
            companyId,
            invoicyConfigId: config.id,
            orderId: dto.orderId,
            quotationId: dto.quotationId,
            numero: reservedNumber,
            serie: series,
            status: isContingency
              ? NfceStatus.CONTINGENCY
              : NfceStatus.PROCESSING,
            ambiente: environment === 'PRODUCAO' ? 1 : 2,
            valorTotal,
            valorDesconto: dto.itens.reduce(
              (acc, item) => acc + (item.valorDesconto || 0),
              0,
            ),
            valorTroco: dto.valorTroco || 0,
            formaPagamento: dto.pagamentos[0]?.tipo || '01',
            cpfConsumidor: dto.cpfConsumidor || null,
            consumidorNome: dto.consumidorNome || null,
            informacoesComplementares:
              dto.informacoesComplementares || config.taxInfoText || null,
            itensSnapshot: dto.itens as any,
            pagamentosSnapshot: dto.pagamentos as any,
            invoicyPayloadEnvio: invoicyRequest as any,
          },
        });

        return { nfce, invoicyRequest };
      },
    );

    try {
      this.logger.log(
        `Emitindo NFC-e ${nfce.numero}/${environment} para empresa ${companyId}`,
      );

      // Chamar API do Invoicy
      const invoicyResponses = await this.invoicyApiService.emitNfe(
        companyId,
        [invoicyRequest],
        config.id,
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
      if (!doc) {
        throw new Error('Documento não retornado pelo Invoicy');
      }

      const situacao = doc.Situacao;
      const isAuthorized =
        situacao?.SitCodigo === 100 || situacao?.SitCodigo === 150;

      const targetStatus = isContingency
        ? NfceStatus.CONTINGENCY
        : isAuthorized
          ? NfceStatus.AUTHORIZED
          : NfceStatus.REJECTED;

      // Atualizar NFC-e com resposta
      const updatedNfce = await this.prisma.nfce.update({
        where: { id: nfce.id },
        data: {
          status: targetStatus,
          chaveAcesso: doc.DocChaAcesso || null,
          protocolo: doc.DocProtocolo || null,
          invoicyId: doc.DocIDUnico || null,
          invoicyProtocol: doc.DocProtocolo || null,
          dataEmissao: new Date(),
          dataAutorizacao: isAuthorized ? new Date() : null,
          qrCodeUrl: doc.DocCompleto || null,
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

      return updatedNfce;
    } catch (error) {
      // Distinguir erro de transporte de rejeição fiscal
      const isUnknownOutcome =
        error?.code === 'ECONNABORTED' ||
        error?.code === 'ECONNRESET' ||
        error?.code === 'ETIMEDOUT' ||
        error?.response === undefined ||
        error?.response?.status >= 500;

      const newStatus = isUnknownOutcome
        ? NfceStatus.UNKNOWN
        : NfceStatus.REJECTED;
      const motivoRejeicao = isUnknownOutcome
        ? 'Erro de transporte — resultado desconhecido'
        : this.extractSafeErrorMessage(error);

      await this.prisma.nfce.update({
        where: { id: nfce.id },
        data: {
          status: newStatus,
          motivoRejeicao,
        },
      });

      // Log sem secrets: apenas número, série, ambiente, status
      this.logger.error(
        `Emissão NFC-e ${nfce.numero}/${environment} falhou (${newStatus}): ${error?.code ?? error?.constructor?.name}`,
      );

      if (isUnknownOutcome) {
        throw new BadRequestException(
          'Falha de comunicação com o Invoicy. A NFC-e está em estado DESCONHECIDO — ' +
            'use o endpoint de reprocessamento para verificar o resultado antes de reemitir.',
        );
      }
      throw new BadRequestException(`NFC-e rejeitada: ${motivoRejeicao}`);
    }
  }

  private extractSafeErrorMessage(error: any): string {
    const structured =
      error?.response?.data?.Descricao ||
      error?.response?.data?.descricao ||
      error?.response?.data?.Mensagem ||
      error?.response?.data?.mensagem ||
      error?.response?.data?.message ||
      error?.message;

    return typeof structured === 'string' && structured.trim()
      ? structured.trim().slice(0, 500)
      : 'Erro fiscal desconhecido';
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

  async reprocess(id: string, companyId: string) {
    return this.reprocessWithAtomicClaim(id, companyId);
  }
  private async reprocessWithAtomicClaim(id: string, companyId: string) {
    const staleBefore = new Date(Date.now() - 5 * 60 * 1000);
    const claimed = await this.prisma.nfce.updateMany({
      where: {
        id,
        companyId,
        OR: [
          { status: NfceStatus.UNKNOWN },
          { status: NfceStatus.PROCESSING, updatedAt: { lt: staleBefore } },
        ],
      },
      data: {
        status: NfceStatus.PROCESSING,
        motivoRejeicao: null,
      },
    });

    if (claimed.count !== 1) {
      const current = await this.findById(id, companyId);
      throw new ConflictException(
        `NFC-e nao esta disponivel para reprocessamento. Status atual: ${current.status}`,
      );
    }

    const nfce = await this.findById(id, companyId);

    if (!nfce.invoicyPayloadEnvio || !nfce.invoicyConfigId) {
      await this.prisma.nfce.update({
        where: { id: nfce.id },
        data: {
          status: NfceStatus.UNKNOWN,
          motivoRejeicao:
            'Payload original ou emissor ausente; reprocessamento automatico bloqueado',
        },
      });
      throw new BadRequestException(
        'Impossivel reprocessar: payload original ou emissor nao encontrado. Faca consulta manual antes de qualquer nova emissao.',
      );
    }

    const emissor = await this.prisma.invoicyConfig.findFirst({
      where: { id: nfce.invoicyConfigId, companyId },
      select: { id: true },
    });
    if (!emissor) {
      await this.prisma.nfce.update({
        where: { id: nfce.id },
        data: {
          status: NfceStatus.UNKNOWN,
          motivoRejeicao:
            'Emissor original nao encontrado; reprocessamento automatico bloqueado',
        },
      });
      throw new BadRequestException(
        'Emissor original da NFC-e nao encontrado para esta empresa.',
      );
    }

    if (nfce.chaveAcesso) {
      const responses = await this.invoicyApiService.consultNfeSefaz(
        companyId,
        nfce.chaveAcesso,
        nfce.invoicyConfigId,
      );
      const doc = responses[0]?.Documentos?.[0];
      const situacao = doc?.Situacao;

      if (situacao?.SitCodigo === 100 || situacao?.SitCodigo === 150) {
        return this.prisma.nfce.update({
          where: { id: nfce.id },
          data: {
            status: NfceStatus.AUTHORIZED,
            protocolo: doc.DocProtocolo || nfce.protocolo,
            dataAutorizacao: new Date(),
            motivoRejeicao: null,
          },
        });
      }

      if (
        situacao &&
        situacao.SitCodigo !== 100 &&
        situacao.SitCodigo !== 150
      ) {
        return this.prisma.nfce.update({
          where: { id: nfce.id },
          data: {
            status: NfceStatus.REJECTED,
            motivoRejeicao: situacao.SitDescricao,
          },
        });
      }
    }

    const environment =
      await this.fiscalCredentialResolver.resolveOperationalEnvironment(
        companyId,
        nfce.invoicyConfigId,
        'NFCE',
      );

    try {
      this.logger.log(
        `Reprocessando NFC-e ${nfce.numero}/${environment} (id: ${nfce.id})`,
      );

      const invoicyResponses = await this.invoicyApiService.emitNfe(
        companyId,
        [nfce.invoicyPayloadEnvio as any],
        nfce.invoicyConfigId,
      );

      const response = invoicyResponses[0];
      if (!response) {
        throw new Error('Nenhuma resposta recebida do Invoicy');
      }

      const doc = response.Documentos?.[0];
      if (!doc) {
        throw new Error('Documento nao retornado pelo Invoicy');
      }

      const situacao = doc.Situacao;
      const isAuthorized =
        situacao?.SitCodigo === 100 || situacao?.SitCodigo === 150;
      const payload = nfce.invoicyPayloadEnvio as any;
      const isContingency =
        payload?.Documento?.ide?.tpEmis === 9 || nfce.contingencia;

      const targetStatus = isContingency
        ? NfceStatus.CONTINGENCY
        : isAuthorized
          ? NfceStatus.AUTHORIZED
          : NfceStatus.REJECTED;

      return this.prisma.nfce.update({
        where: { id: nfce.id },
        data: {
          status: targetStatus,
          chaveAcesso: doc.DocChaAcesso || nfce.chaveAcesso,
          protocolo: doc.DocProtocolo || nfce.protocolo,
          invoicyId: doc.DocIDUnico || nfce.invoicyId,
          invoicyProtocol: doc.DocProtocolo || nfce.invoicyProtocol,
          dataAutorizacao: isAuthorized ? new Date() : nfce.dataAutorizacao,
          qrCodeUrl: doc.DocCompleto || nfce.qrCodeUrl,
          danfeUrl: doc.DocPDFDownload || nfce.danfeUrl,
          xmlAutorizado: doc.DocXMLBase64
            ? Buffer.from(doc.DocXMLBase64, 'base64').toString('utf-8')
            : nfce.xmlAutorizado,
          motivoRejeicao: !isAuthorized ? situacao?.SitDescricao : null,
        },
      });
    } catch (error) {
      const isUnknownOutcome =
        error?.code === 'ECONNABORTED' ||
        error?.code === 'ECONNRESET' ||
        error?.code === 'ETIMEDOUT' ||
        error?.response === undefined ||
        error?.response?.status >= 500;

      if (isUnknownOutcome) {
        await this.prisma.nfce.update({
          where: { id: nfce.id },
          data: {
            status: NfceStatus.UNKNOWN,
            motivoRejeicao:
              'Erro de comunicacao/provedor no reprocessamento - resultado desconhecido',
          },
        });
        throw new BadRequestException(
          'Falha de comunicacao novamente. A NFC-e permanece em estado DESCONHECIDO. Tente novamente em alguns instantes.',
        );
      }

      const safeReason = this.extractSafeErrorMessage(error);
      await this.prisma.nfce.update({
        where: { id: nfce.id },
        data: {
          status: NfceStatus.REJECTED,
          motivoRejeicao: safeReason,
        },
      });
      throw new BadRequestException(`Reprocessamento falhou: ${safeReason}`);
    }
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

    // Verificar se está dentro do prazo (configurável por estado/emissor)
    const config = await this.invoicyService.getConfig(companyId);
    const prazoMinutos = config?.prazoCancelamentoNfce ?? 30;

    const minutosDaEmissao =
      (Date.now() - new Date(nfce.dataEmissao).getTime()) / (1000 * 60);
    if (minutosDaEmissao > prazoMinutos) {
      throw new BadRequestException(
        `O prazo para cancelamento de NFC-e foi excedido (${prazoMinutos} minutos)`,
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

    const updatedConfig = await this.prisma.invoicyConfig.update({
      where: { id: config.id },
      data: {
        contingenciaNfceAtiva: dto.ativar ?? false,
        contingenciaNfceMotivo: dto.ativar ? dto.motivo : null,
        contingenciaNfceDataHora: dto.ativar ? new Date() : null,
      },
    });

    this.logger.log(
      `${dto.ativar ? 'Ativando' : 'Desativando'} contingência para empresa ${companyId}`,
    );

    return {
      success: true,
      contingenciaAtiva: updatedConfig.contingenciaNfceAtiva,
      motivo: updatedConfig.contingenciaNfceMotivo,
      dataHora: updatedConfig.contingenciaNfceDataHora,
    };
  }

  async consultStatus(id: string, companyId: string) {
    const nfce = await this.findById(id, companyId);

    if (!nfce.chaveAcesso) {
      return {
        id: nfce.id,
        numero: nfce.numero,
        serie: nfce.serie,
        status: nfce.status,
        statusDescription: 'Chave de acesso não disponível para consulta',
        checkedAt: new Date().toISOString(),
      };
    }

    try {
      this.logger.log(`Consultando status real NFC-e ${nfce.numero} na SEFAZ`);

      const invoicyResponses = await this.invoicyApiService.consultNfeSefaz(
        companyId,
        nfce.chaveAcesso,
        nfce.invoicyConfigId || undefined,
      );

      const response = invoicyResponses[0];
      const doc = response?.Documentos?.[0];
      const situacao = doc?.Situacao;

      let newStatus = null;
      if (situacao?.SitCodigo) {
        const map: Record<number, string> = {
          100: 'AUTHORIZED',
          101: 'CANCELLED',
          102: 'CANCELLED',
          135: 'CANCELLED',
          204: 'AUTHORIZED',
          217: 'REJECTED',
        };
        newStatus = map[situacao.SitCodigo];
      }

      let currentStatus = nfce.status;
      if (newStatus && newStatus !== nfce.status) {
        this.logger.log(
          `Status NFC-e ${nfce.numero} mudou: ${nfce.status} → ${newStatus}`,
        );

        await this.prisma.nfce.update({
          where: { id: nfce.id },
          data: { status: newStatus as any },
        });
        currentStatus = newStatus as any;
      }

      return {
        id: nfce.id,
        numero: nfce.numero,
        serie: nfce.serie,
        status: currentStatus,
        statusChanged: newStatus !== nfce.status,
        sefazCode: situacao?.SitCodigo,
        sefazDescription: situacao?.SitDescricao,
        chaveAcesso: nfce.chaveAcesso,
        protocolo: nfce.protocolo,
        dataEmissao: nfce.dataEmissao,
        dataAutorizacao: nfce.dataAutorizacao,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(
        `Erro ao consultar status NFC-e ${nfce.numero}: ${error.message}`,
        error.stack,
      );
      return {
        id: nfce.id,
        numero: nfce.numero,
        serie: nfce.serie,
        status: nfce.status,
        sefazError: error.message,
        checkedAt: new Date().toISOString(),
      };
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
