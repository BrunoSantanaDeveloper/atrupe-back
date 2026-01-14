import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { NfeStatus } from '@prisma/client';
import { InvoicyService } from '../invoicy/invoicy.service';
import { InvoicyHttpService } from '../invoicy/invoicy-http.service';
import {
  InvoicyNfeRequest,
  INVOICY_SUCCESS_CODES,
} from '../invoicy/invoicy.types';
import { fetchCepData } from '../utils/cep.util';
import {
  EmitNfeDto,
  EmitNfeFromOrderDto,
  CancelNfeDto,
  CorrectionLetterDto,
  NfeFilterDto,
} from './dtos/nfe.dto';

@Injectable()
export class NfeService {
  private readonly logger = new Logger(NfeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoicyService: InvoicyService,
    private readonly invoicyHttpService: InvoicyHttpService,
  ) {}

  /**
   * Prepara os dados para emissão de NF-e a partir de uma ordem de serviço.
   * Retorna todos os dados pré-preenchidos para o frontend editar antes de emitir.
   */
  async prepareFromOrder(companyId: string, orderId: string) {
    // Buscar a ordem via quotation para garantir o filtro por companyId
    const quotation = (await this.prisma.quotation.findFirst({
      where: {
        companyId,
        order: { id: orderId },
      },
      include: {
        client: {
          include: {
            address: true,
          },
        },
        order: {
          include: {
            nfes: true, // Incluir NF-e já emitidas
          },
        },
        quotationProduct: {
          include: {
            product: {
              include: {
                fiscalData: true,
              },
            },
          },
        },
        series: true,
        quotationPayment: {
          include: {
            paymentCondition: true,
          },
        },
      },
    })) as any;

    if (!quotation || !quotation.order) {
      throw new NotFoundException('Ordem de serviço não encontrada');
    }

    const client = quotation.client;
    if (!client) {
      throw new BadRequestException('Cliente não encontrado no orçamento');
    }

    // Buscar configuração do Invoicy para defaults
    const config = await this.invoicyService.getConfig(companyId);
    if (!config) {
      throw new BadRequestException(
        'Configuração do Invoicy não encontrada. Configure a integração primeiro.',
      );
    }

    // Obter endereço principal do cliente
    const clientAddress = client.address?.[0];

    // Preparar itens da NF-e com dados fiscais completos
    const items = quotation.quotationProduct.map((qp, index) => {
      const totalValueCents = qp.finalValue || qp.totalValue || 0;
      const totalValueReais = totalValueCents / 100;
      const unitValue = qp.quantity > 0 ? totalValueReais / qp.quantity : 0;
      const discountReais = (qp.discount || 0) / 100;
      const fiscalData = qp.product?.fiscalData;

      return {
        itemNumber: index + 1,
        productId: qp.productId,
        productCode: qp.product?.code || '',
        description: qp.product?.name || 'Produto/Serviço',
        ncm: fiscalData?.ncm || '',
        cfop: fiscalData?.cfop || config.defaultCfop || '',
        cstIcms: fiscalData?.cstIcms || '102',
        cstIpi: fiscalData?.cstIpi || '',
        cstPis: fiscalData?.cstPis || '',
        cstCofins: fiscalData?.cstCofins || '',
        unit: qp.product?.unit || 'UN',
        quantity: qp.quantity,
        unitValue: Number(unitValue.toFixed(2)),
        discount: Number(discountReais.toFixed(2)),
        freight: 0,
        insurance: 0,
        totalValue: Number(totalValueReais.toFixed(2)),
        needsConfiguration: !fiscalData?.ncm || !fiscalData?.cfop,
      };
    });

    // Calcular totais
    const valorProdutos = items.reduce((acc, item) => acc + item.totalValue, 0);
    const valorDescontos = items.reduce((acc, item) => acc + item.discount, 0);
    const valorNota = valorProdutos - valorDescontos;

    // Verificar se já existe NF-e emitida para esta ordem
    const existingNfe = quotation.order.nfes?.[0];

    return {
      // Metadados
      orderId,
      quotationId: quotation.id,
      orderCode: `${quotation.series?.code || ''}-${quotation.series?.quotation || ''}`,
      hasExistingNfe: !!existingNfe,
      existingNfe: existingNfe
        ? {
            id: existingNfe.id,
            numero: existingNfe.numero,
            serie: existingNfe.serie,
            status: existingNfe.status,
            chaveAcesso: existingNfe.chaveAcesso,
            danfeUrl: existingNfe.danfeUrl,
            dataEmissao: existingNfe.dataEmissao,
          }
        : null,

      // Configuração de emissão
      emissao: {
        emissor: config.emitRazaoSocial || config.emitNomeFantasia || '',
        emissorCnpj: config.emitCnpj || '',
        proximoDocumento: `${config.proximoNumeroNfe || 1} - ${config.serieNfe || 1}`,
        serie: config.serieNfe || 1,
        tipo: 1, // 1 = Saída
        finalidade: 1, // 1 = NF-e normal
        operationNature: config.defaultOperationNature || 'Venda de mercadoria',
        consumidorFinal: client.cnpj ? 0 : 1, // 0 = Não, 1 = Sim (pessoa física)
        presencaConsumidor: 1, // 1 = Operação presencial
        nfeReferenciada: null,
        dataSaida: new Date().toISOString(),
        destinoOperacao: clientAddress?.state === config.emitUf ? 1 : 2, // 1 = Interna, 2 = Interestadual
        modalidadeFrete: 9, // 9 = Sem ocorrência de transporte
        ambiente: config.ambiente || 'HOMOLOGACAO',
      },

      // Destinatário
      destinatario: {
        razaoSocial: client.corporateName || client.name || '',
        cnpjCpf: client.cnpj || client.cpf || '',
        ie: client.ie || '',
        email: client.email || '',
        telefone: client.phone || '',
        cep: clientAddress?.zipcode || '',
        estado: clientAddress?.state || '',
        cidade: clientAddress?.city || '',
        bairro: clientAddress?.neighborhood || '',
        endereco: clientAddress?.street || '',
        numero: clientAddress?.number || 'S/N',
        complemento: clientAddress?.complement || '',
        pais: '1058', // Brasil
      },

      // Itens
      items,

      // Transportadora (vazio por padrão)
      transportadora: {
        cnpjCpf: '',
        razaoSocial: '',
        ie: '',
        endereco: '',
        cidade: '',
        uf: '',
      },

      // Volumes
      volumes: [],

      // Pagamento
      pagamento: {
        forma: quotation.quotationPayment?.paymentCondition?.name || 'Dinheiro',
        valor: valorNota,
      },

      // Duplicatas
      duplicatas: [],

      // Informações complementares
      informacoesComplementares: config.taxInfoText || '',

      // Totais
      totais: {
        valorProdutos: Number(valorProdutos.toFixed(2)),
        baseCalculoIcms: 0,
        valorIcms: 0,
        baseCalculoIcmsSt: 0,
        valorIcmsSt: 0,
        valorPis: 0,
        valorCofins: 0,
        valorIpi: 0,
        valorFrete: 0,
        valorSeguro: 0,
        outrasDesepesas: 0,
        valorDesconto: Number(valorDescontos.toFixed(2)),
        valorTotalTributos: 0,
        valorNota: Number(valorNota.toFixed(2)),
      },
    };
  }

  // Emitir NF-e a partir de uma ordem de serviço (busca dados automaticamente)

  async emitFromOrder(companyId: string, dto: EmitNfeFromOrderDto) {
    // Buscar a ordem via quotation para garantir o filtro por companyId
    const quotation = await this.prisma.quotation.findFirst({
      where: {
        companyId,
        order: { id: dto.orderId },
      },
      include: {
        client: {
          include: {
            address: true,
          },
        },
        order: true,
        quotationProduct: {
          include: {
            product: {
              include: {
                fiscalData: true,
              },
            },
          },
        },
      },
    });

    if (!quotation || !quotation.order) {
      throw new NotFoundException('Ordem de serviço não encontrada');
    }

    // Verificar se já existe NF-e autorizada para esta ordem
    const existingNfe = await this.prisma.nfe.findFirst({
      where: {
        orderId: dto.orderId,
        status: NfeStatus.AUTHORIZED,
      },
    });

    if (existingNfe) {
      throw new BadRequestException(
        `Já existe uma NF-e autorizada para esta ordem de serviço (Nº ${existingNfe.numero}/${existingNfe.serie})`,
      );
    }

    const client = quotation.client;
    if (!client) {
      throw new BadRequestException('Cliente não encontrado no orçamento');
    }

    // Buscar configuração do Invoicy para defaults
    const config = await this.invoicyService.getConfig(companyId);
    if (!config) {
      throw new BadRequestException(
        'Configuração do Invoicy não encontrada. Configure a integração primeiro.',
      );
    }

    // Preparar itens da NF-e (usar totalValue ou finalValue dividido pela quantidade)
    // IMPORTANTE: Valores no banco estão em centavos, dividir por 100 para reais
    const items = quotation.quotationProduct.map((qp) => {
      const totalValueCents = qp.finalValue || qp.totalValue || 0;
      const totalValueReais = totalValueCents / 100;
      const unitValue = qp.quantity > 0 ? totalValueReais / qp.quantity : 0;
      const discountReais = (qp.discount || 0) / 100;
      return {
        productId: qp.productId,
        quantity: qp.quantity,
        unitValue,
        discount: discountReais,
      };
    });

    if (items.length === 0) {
      throw new BadRequestException('Orçamento não possui itens');
    }

    // Obter endereço principal do cliente
    const clientAddress = client.address?.[0];

    // Construir DTO completo
    const fullDto: EmitNfeDto = {
      orderId: dto.orderId,
      quotationId: quotation.id,
      operationNature:
        dto.operationNature ||
        config.defaultOperationNature ||
        'Venda de mercadoria',
      additionalInfo: dto.additionalInfo || config.taxInfoText || '',
      destCnpjCpf: client.cnpj || client.cpf || '',
      destNome: client.corporateName || client.name || '',
      destEmail: client.email || '',
      destEndereco: clientAddress?.street || '',
      destNumero: clientAddress?.number || 'S/N',
      destComplemento: clientAddress?.complement || '',
      destBairro: clientAddress?.neighborhood || '',
      destCep: clientAddress?.zipcode || '',
      destMunicipio: clientAddress?.city || '',
      destUf: clientAddress?.state || '',
      destPais: '1058',
      items,
    };

    // Validar dados obrigatórios
    if (!fullDto.destCnpjCpf) {
      throw new BadRequestException('Cliente não possui CPF/CNPJ cadastrado');
    }
    if (!fullDto.destNome) {
      throw new BadRequestException('Cliente não possui nome cadastrado');
    }
    if (!fullDto.destEndereco) {
      throw new BadRequestException('Cliente não possui endereço cadastrado');
    }

    return this.emit(companyId, fullDto);
  }

  async findAll(companyId: string, filters: NfeFilterDto) {
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
      this.prisma.nfe.findMany({
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
      this.prisma.nfe.count({ where }),
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
    const nfe = await this.prisma.nfe.findFirst({
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

    if (!nfe) {
      throw new NotFoundException('NF-e não encontrada');
    }

    return nfe;
  }

  async findByChaveAcesso(chaveAcesso: string, companyId: string) {
    const nfe = await this.prisma.nfe.findFirst({
      where: { chaveAcesso, companyId },
    });

    if (!nfe) {
      throw new NotFoundException('NF-e não encontrada');
    }

    return nfe;
  }

  async emit(companyId: string, dto: EmitNfeDto) {
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

    // Validar que temos itens
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('NF-e deve conter ao menos um item');
    }

    // Validar destinatário
    const cleanCnpjCpf = dto.destCnpjCpf?.replace(/\D/g, '') || '';
    if (
      !cleanCnpjCpf ||
      (cleanCnpjCpf.length !== 11 && cleanCnpjCpf.length !== 14)
    ) {
      throw new BadRequestException(
        'CPF/CNPJ do destinatário é obrigatório e deve ser válido (11 dígitos para CPF ou 14 para CNPJ)',
      );
    }

    // Buscar código IBGE do município do destinatário via CEP
    let destCmun = 0;
    let destUfFromCep = dto.destUf || '';
    let destMunFromCep = dto.destMunicipio || '';
    if (dto.destCep) {
      this.logger.log(
        `Buscando código IBGE para CEP do destinatário: ${dto.destCep}`,
      );
      const cepData = await fetchCepData(dto.destCep);
      if (cepData) {
        destCmun = parseInt(cepData.codigoIbge, 10) || 0;
        destUfFromCep = cepData.uf; // Usar UF do CEP para garantir consistência
        destMunFromCep = cepData.cidade; // Usar cidade do CEP
        this.logger.log(
          `Código IBGE do destinatário: ${destCmun} (${destMunFromCep}/${destUfFromCep})`,
        );
      } else {
        this.logger.warn(`CEP do destinatário não encontrado: ${dto.destCep}`);
      }
    } else {
      this.logger.warn('Destinatário sem CEP cadastrado');
    }

    // Validar que temos o código IBGE do destinatário
    if (!destCmun) {
      throw new BadRequestException(
        'CEP do destinatário é obrigatório para emissão de NF-e. Cadastre um CEP válido para o cliente.',
      );
    }

    // Obter próximo número da NF-e
    const numero = await this.invoicyService.incrementNfeNumber(companyId);

    // Calcular valor total
    const valorTotal = dto.items.reduce(
      (acc, item) =>
        acc + item.quantity * item.unitValue - (item.discount || 0),
      0,
    );

    // Criar registro da NF-e
    const nfe = await this.prisma.nfe.create({
      data: {
        companyId,
        orderId: dto.orderId,
        quotationId: dto.quotationId,
        numero,
        serie: config.serieNfe,
        status: NfeStatus.PROCESSING,
        ambiente: config.ambiente,
        valorTotal,
      },
    });

    try {
      this.logger.log(`Emitindo NF-e ${numero} para empresa ${companyId}`);

      // Construir payload para o Invoicy
      const now = new Date();
      const invoicyRequest: InvoicyNfeRequest = {
        Documento: {
          ModeloDocumento: 'NFe',
          Versao: 4,
          ide: {
            cUF: this.getUfCode(config.emitUf),
            natOp:
              dto.operationNature ||
              config.defaultOperationNature ||
              'Venda de mercadoria',
            mod: '55',
            serie: config.serieNfe?.toString() || '1',
            nNF: numero,
            dhEmi: now.toISOString(),
            fusoHorario: '-03:00',
            tpNf: 1, // 1 = Saída
            idDest: destUfFromCep === config.emitUf ? 1 : 2, // 1 = Interna, 2 = Interestadual
            cMunFg: parseInt(config.emitCmun || '0', 10),
            tpImp: 1, // DANFE retrato
            tpEmis: 1, // Emissão normal
            cDV: 0, // Será calculado pelo Invoicy
            tpAmb: config.ambiente === 'PRODUCAO' ? 1 : 2,
            finNFe: 1, // NF-e normal
            indFinal: dto.destCnpjCpf?.length === 11 ? 1 : 0, // 1 = Consumidor final (CPF)
            indPres: 1, // Operação presencial
            procEmi: 0, // Aplicativo do contribuinte
            verProc: 'Atrupe 1.0',
          },
          emit: {
            CNPJ_emit: (config.emitCnpj || '').replace(/\D/g, ''),
            xNome: config.emitRazaoSocial || '',
            IE: (config.emitIe || '').replace(/\D/g, ''),
            IM: config.emitIm || undefined,
            CRT: config.emitCrt || 1,
            enderEmit: {
              xLgr: config.emitEndereco || '',
              nro: config.emitNumero || 'S/N',
              xBairro: config.emitBairro || '',
              cMun: parseInt(config.emitCmun || '0', 10),
              xMun: config.emitXMun || '',
              UF: config.emitUf || '',
              CEP: parseInt((config.emitCep || '').replace(/\D/g, ''), 10) || 0,
            },
          },
          dest: {
            // CNPJ ou CPF devem vir ANTES de xNome no schema da SEFAZ
            ...(dto.destCnpjCpf?.replace(/\D/g, '').length === 14
              ? { CNPJ_dest: dto.destCnpjCpf.replace(/\D/g, '') }
              : {}),
            ...(dto.destCnpjCpf?.replace(/\D/g, '').length === 11
              ? { CPF_dest: dto.destCnpjCpf.replace(/\D/g, '') }
              : {}),
            // Em homologação, SEFAZ exige este nome exato para o destinatário
            xNome_dest:
              config.ambiente === 'HOMOLOGACAO' || config.ambiente !== 1
                ? 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL'
                : dto.destNome || '',
            indIEDest: 9, // 9 = Não contribuinte
            enderDest: {
              xLgr_dest: dto.destEndereco || '',
              nro_dest: dto.destNumero || 'S/N',
              xBairro_dest: dto.destBairro || '',
              cMun_dest: destCmun, // Código IBGE do município do destinatário
              xMun_dest: destMunFromCep, // Nome do município (do CEP)
              UF_dest: destUfFromCep, // UF do destinatário (do CEP para garantir consistência)
              CEP_dest:
                parseInt((dto.destCep || '').replace(/\D/g, ''), 10) || 0,
              cPais_dest: parseInt(dto.destPais || '1058', 10),
            },
          },
          det: dto.items.map((item, index) => ({
            prod: {
              cProd: item.productId || `ITEM${index + 1}`,
              cEAN: item.ean || 'SEM GTIN',
              cEANTrib: item.ceantrib || 'SEM GTIN',
              xProd: item.description || `Produto ${index + 1}`,
              NCM: (item.ncm || '00000000').replace(/\D/g, ''),
              // CFOP: 5xxx para operação interna (mesmo estado), 6xxx para interestadual
              CFOP: (() => {
                const baseCfop =
                  item.cfop || parseInt(config.defaultCfop || '5102', 10);
                // Se é operação interestadual e CFOP começa com 5, converter para 6
                if (
                  destUfFromCep !== config.emitUf &&
                  Math.floor(baseCfop / 1000) === 5
                ) {
                  return baseCfop + 1000; // 5102 -> 6102
                }
                return baseCfop;
              })(),
              uCOM: item.uCom || 'UN',
              qCOM: item.quantity.toFixed(4),
              vUnCom: item.unitValue.toFixed(10),
              vProd: (item.quantity * item.unitValue).toFixed(2),
              uTrib: item.uCom || 'UN', // Usually same as uCom
              qTrib: item.quantity.toFixed(4),
              vUnTrib: item.unitValue.toFixed(10),
              indTot: 1,
            },
            imposto: {
              ICMS: {
                orig: 0, // Nacional
                CST: item.cstIcms || '102', // Default Simples Nacional if missing
              },
              PIS: {
                CST_pis: item.cstPis || '49',
              },
              COFINS: {
                CST_cofins: item.cstCofins || '49',
              },
              IPI: {
                CST_ipi: item.cstIpi || '99',
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
              vDesc_ttlnfe: dto.items
                .reduce((acc, i) => acc + (i.discount || 0), 0)
                .toFixed(2),
              vII_ttlnfe: '0.00',
              vIPI_ttlnfe: '0.00',
              vPIS_ttlnfe: '0.00',
              vCOFINS_ttlnfe: '0.00',
              vOutro: '0.00',
              vNF: valorTotal.toFixed(2),
            },
          },
          pag: [
            {
              tPag: '01', // Dinheiro
              vPag: valorTotal.toFixed(2),
            },
          ],
          transp: {
            modFrete: '9', // Sem frete
          },
        },
      };

      // Chamar API do Invoicy
      const invoicyResponses = await this.invoicyHttpService.emitNfe(
        companyId,
        [invoicyRequest],
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

      // Verificar situação do documento
      const situacao = doc.Situacao;
      const isAuthorized =
        situacao?.SitCodigo === 100 || situacao?.SitCodigo === 150;

      // Atualizar NF-e com resposta
      const updatedNfe = await this.prisma.nfe.update({
        where: { id: nfe.id },
        data: {
          status: isAuthorized ? NfeStatus.AUTHORIZED : NfeStatus.REJECTED,
          chaveAcesso: doc.DocChaAcesso || null,
          protocolo: doc.DocProtocolo || null,
          invoicyId: doc.DocIDUnico || null,
          invoicyProtocol: doc.DocProtocolo || null,
          dataEmissao: new Date(),
          dataAutorizacao: isAuthorized ? new Date() : null,
          danfeUrl: doc.DocPDFDownload || null,
          xmlAutorizado: doc.DocXMLBase64
            ? Buffer.from(doc.DocXMLBase64, 'base64').toString('utf-8')
            : null,
          motivoRejeicao: !isAuthorized ? situacao?.SitDescricao : null,
        },
      });

      if (!isAuthorized) {
        throw new BadRequestException(
          `NF-e rejeitada: ${situacao?.SitDescricao || 'Motivo desconhecido'}`,
        );
      }

      return updatedNfe;
    } catch (error) {
      // Atualizar status para rejeitado em caso de erro
      await this.prisma.nfe.update({
        where: { id: nfe.id },
        data: {
          status: NfeStatus.REJECTED,
          motivoRejeicao: error.message,
        },
      });

      this.logger.error(`Erro ao emitir NF-e: ${error.message}`, error.stack);
      throw new BadRequestException(`Erro ao emitir NF-e: ${error.message}`);
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
    return ufCodes[uf?.toUpperCase()] || 43; // Default RS
  }

  async cancel(id: string, companyId: string, dto: CancelNfeDto) {
    const nfe = await this.findById(id, companyId);

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
      const invoicyResponses = await this.invoicyHttpService.cancelNfe(
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
        where: { id },
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

  async sendCorrectionLetter(
    id: string,
    companyId: string,
    dto: CorrectionLetterDto,
  ) {
    const nfe = await this.findById(id, companyId);

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
        await this.invoicyHttpService.sendCorrectionLetter(
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
        where: { id },
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

  async consultStatus(id: string, companyId: string) {
    const nfe = await this.findById(id, companyId);

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

  async getDanfeUrl(id: string, companyId: string) {
    const nfe = await this.findById(id, companyId);

    if (!nfe.danfeUrl) {
      // TODO: Buscar DANFE da API do Invoicy se não estiver armazenado
      throw new NotFoundException('DANFE não disponível para esta NF-e');
    }

    return { url: nfe.danfeUrl };
  }

  async getXml(id: string, companyId: string) {
    const nfe = await this.findById(id, companyId);

    if (!nfe.xmlAutorizado) {
      // TODO: Buscar XML da API do Invoicy se não estiver armazenado
      throw new NotFoundException('XML não disponível para esta NF-e');
    }

    return { xml: nfe.xmlAutorizado };
  }
}
