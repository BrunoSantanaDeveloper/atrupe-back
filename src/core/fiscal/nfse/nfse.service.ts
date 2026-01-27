import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { NfseStatus } from '@prisma/client';
import { InvoicyService } from '../invoicy/invoicy.service';
import { InvoicyHttpService } from '../invoicy/invoicy-http.service';
import {
  InvoicyNfseRequest,
  INVOICY_SUCCESS_CODES,
} from '../invoicy/invoicy.types';
import {
  EmitNfseDto,
  EmitNfseFromOrderDto,
  CancelNfseDto,
  NfseFilterDto,
} from './dtos/nfse.dto';

@Injectable()
export class NfseService {
  private readonly logger = new Logger(NfseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoicyService: InvoicyService,
    private readonly invoicyHttpService: InvoicyHttpService,
  ) {}

  async findAll(companyId: string, filters: NfseFilterDto) {
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
      this.prisma.nfse.findMany({
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
      this.prisma.nfse.count({ where }),
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
    const nfse = await this.prisma.nfse.findFirst({
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

    if (!nfse) {
      throw new NotFoundException('NFS-e não encontrada');
    }

    return nfse;
  }

  // Emitir NFS-e a partir de uma ordem de serviço (busca dados automaticamente)
  async emitFromOrder(companyId: string, dto: EmitNfseFromOrderDto) {
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
            product: true,
          },
        },
      },
    });

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

    // Calcular valor total dos serviços (usar finalValue ou totalValue)
    // IMPORTANTE: Valores no banco estão em centavos, dividir por 100 para reais
    const valorServicos =
      quotation.quotationProduct.reduce(
        (acc: number, qp) => acc + (qp.finalValue || qp.totalValue || 0),
        0,
      ) / 100;

    // Obter endereço principal do cliente
    const clientAddress = client.address?.[0];

    // Construir DTO completo
    const fullDto: EmitNfseDto = {
      orderId: dto.orderId,
      quotationId: quotation.id,
      dataCompetencia: new Date().toISOString().split('T')[0],
      naturezaOperacao: 1, // Tributação no município
      codigoServico: dto.codigoServico,
      discriminacao: dto.discriminacao,
      codigoMunicipio: config.ibgeCode || '',
      valorServicos,
      aliquotaIss: dto.aliquotaIss || config.aliquotaIss || 0,
      issRetido: dto.issRetido || false,
      tomador: {
        cnpj: client.cnpj || undefined,
        cpf: client.cpf || undefined,
        razaoSocial: client.corporateName || client.name || '',
        endereco: clientAddress?.street || '',
        numero: clientAddress?.number || 'S/N',
        complemento: clientAddress?.complement || '',
        bairro: clientAddress?.neighborhood || '',
        cep: clientAddress?.zipcode || '',
        codigoMunicipio: config.ibgeCode || '',
        municipio: clientAddress?.city || '',
        uf: clientAddress?.state || '',
        email: client.email || '',
        telefone: client.phone || client.mobile || '',
      },
    };

    // Validar dados obrigatórios
    if (!fullDto.tomador.razaoSocial) {
      throw new BadRequestException('Cliente não possui nome cadastrado');
    }
    if (!fullDto.codigoMunicipio) {
      throw new BadRequestException(
        'Código do município não informado. Verifique o cadastro do cliente ou a configuração fiscal.',
      );
    }

    return this.emit(companyId, fullDto);
  }

  async emit(companyId: string, dto: EmitNfseDto) {
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

    if (!config.company.municipalRegistration) {
      throw new BadRequestException(
        'Inscrição Municipal não configurada. Necessária para emissão de NFS-e.',
      );
    }

    // Obter próximo número do RPS
    const rpsNumero = await this.invoicyService.incrementNfseRpsNumber(
      config.id,
    );
    const rpsSerie = config.serieNfse || 'A1';

    // Calcular valores
    const valorServicos = dto.valorServicos;
    const valorDeducoes = dto.valorDeducoes || 0;
    const baseCalculo = valorServicos - valorDeducoes;
    const aliquotaIss = dto.aliquotaIss || config.aliquotaIss || 0;
    const valorIss = (baseCalculo * aliquotaIss) / 100;

    // Criar registro da NFS-e
    const nfse = await this.prisma.nfse.create({
      data: {
        companyId,
        orderId: dto.orderId,
        quotationId: dto.quotationId,
        numero: 0, // Será preenchido após retorno da prefeitura
        serie: rpsSerie,
        rpsNumero,
        rpsSerie,
        rpsTipo: 1,
        status: NfseStatus.PROCESSING,
        ambiente: config.ambiente,
        dataCompetencia: new Date(dto.dataCompetencia),
        valorServicos,
        valorDeducoes,
        valorPis: dto.valorPis || 0,
        valorCofins: dto.valorCofins || 0,
        valorInss: dto.valorInss || 0,
        valorIr: dto.valorIr || 0,
        valorCsll: dto.valorCsll || 0,
        valorIss,
        aliquotaIss,
        baseCalculo,
        issRetido: dto.issRetido || false,
        codigoServico: dto.codigoServico,
        discriminacao: dto.discriminacao,
        codigoMunicipio: dto.codigoMunicipio,
      },
    });

    try {
      this.logger.log(
        `Emitindo NFS-e (RPS ${rpsNumero}) para empresa ${companyId}`,
      );

      // Função auxiliar para construir lista de itens
      const listaItens = dto.itens?.map((item, index) => ({
        ItemSeq: index + 1,
        ItemCod: item.codigo,
        ItemDesc: item.descricao,
        ItemQtde: item.quantidade,
        ItemvUnit: item.valorUnitario,
        ItemuMed: item.unidade || 'UN',
        ItemvlDed: 0,
        ItemTributavel: 'S',
        ItemTributMunicipio: parseInt(
          item.codigoServico || dto.codigoMunicipio || '0',
          10,
        ),
        ItemvIss:
          (item.quantidade *
            item.valorUnitario *
            (item.aliquotaIss || aliquotaIss)) /
          100,
        ItemAliquota: item.aliquotaIss || aliquotaIss,
        ItemVlrTotal: item.quantidade * item.valorUnitario,
        ItemBaseCalculo: item.quantidade * item.valorUnitario,
        ItemIssRetido: item.issRetido ? 1 : 2,
        ItemIteListServico: parseInt(
          config.codigoServico?.replace(/\D/g, '') || '0',
          10,
        ), // Usar código do serviço principal se não informado no item
        ItemExigibilidadeISS: 1, // Exigível
        ItemcMunIncidencia: parseInt(
          dto.codigoMunicipio || config.ibgeCode || '0',
          10,
        ),
      })) || [
        {
          ItemSeq: 1,
          ItemCod: 'SERV',
          ItemDesc: dto.discriminacao.substring(0, 100), // Invoicy pode ter limite
          ItemQtde: 1,
          ItemvUnit: valorServicos,
          ItemuMed: 'SV',
          ItemvlDed: valorDeducoes,
          ItemTributavel: 'S',
          ItemTributMunicipio: parseInt(
            dto.codigoMunicipio || config.ibgeCode || '0',
            10,
          ),
          ItemvIss: valorIss,
          ItemAliquota: aliquotaIss,
          ItemVlrTotal: valorServicos,
          ItemBaseCalculo: baseCalculo,
          ItemIssRetido: dto.issRetido ? 1 : 2,
          ItemIteListServico: parseInt(
            dto.codigoServico.replace(/\D/g, ''),
            10,
          ),
          ItemExigibilidadeISS: 1,
          ItemcMunIncidencia: parseInt(
            dto.codigoMunicipio || config.ibgeCode || '0',
            10,
          ),
        },
      ];

      // Construir payload para o Invoicy
      const invoicyRequest: InvoicyNfseRequest = {
        Documento: {
          ModeloDocumento: 'NFSE',
          Versao: 1,
          RPS: [
            {
              RPSNumero: rpsNumero.toString(),
              RPSSerie: rpsSerie,
              RPSTipo: 1, // 1 = RPS
              dEmis: new Date().toISOString(),
              dCompetencia: new Date(dto.dataCompetencia).toISOString(),
              LocalPrestServ: 1, // 1 = No município (default)
              natOp: dto.naturezaOperacao || 1, // 1 = Tributação no município
              Operacao: 1,
              RegEspTrib: 1, // 1 = Nenhum
              OptSN: config.emitCrt === 1 ? 1 : 2, // 1 = Sim, 2 = Não
              IncCult: 2, // 2 = Não
              Status: 1, // 1 = Normal
              tpAmb: config.ambiente === 'PRODUCAO' ? 1 : 2,
              Prestador: {
                CNPJ_prest: (config.company.cnpj || '').replace(/\D/g, ''),
                xNome: config.company.legalName || '',
                xFant: config.company.name || '',
                IM: (config.company.municipalRegistration || '').replace(
                  /\D/g,
                  '',
                ),
                enderPrest: {
                  TPEnd: 'Rua', // Default
                  xLgr: config.company.address.street || '',
                  nro: config.company.address.number || 'S/N',
                  xBairro: config.company.address.neighborhood || '',
                  cMun: parseInt(config.ibgeCode || '0', 10),
                  UF: config.company.address.state || '',
                  CEP:
                    parseInt(
                      (config.company.address.zipcode || '').replace(/\D/g, ''),
                      10,
                    ) || 0,
                },
              },
              ListaItens: listaItens,
              Servico: {
                Valores: {
                  ValServicos: valorServicos,
                  ValDeducoes: valorDeducoes,
                  ValPIS: dto.valorPis || 0,
                  ValCOFINS: dto.valorCofins || 0,
                  ValINSS: dto.valorInss || 0,
                  ValIR: dto.valorIr || 0,
                  ValCSLL: dto.valorCsll || 0,
                  ISSRetido: dto.issRetido ? 1 : 2, // 1 = Sim, 2 = Não
                  ValISS: valorIss,
                  ValOutrasRetencoes: 0,
                  ValBaseCalculo: baseCalculo,
                  ValAliqISS: aliquotaIss,
                },
                IteListServico: parseInt(
                  dto.codigoServico.replace(/\D/g, ''),
                  10,
                ),
                Discriminacao: dto.discriminacao,
                cMun: parseInt(
                  dto.codigoMunicipio || config.ibgeCode || '0',
                  10,
                ),
                TributMunicipio: parseInt(
                  dto.codigoMunicipio || config.ibgeCode || '0',
                  10,
                ),
              },
              Tomador: {
                TomaCNPJ: dto.tomador.cnpj
                  ? dto.tomador.cnpj.replace(/\D/g, '')
                  : undefined,
                TomaCPF: dto.tomador.cpf
                  ? dto.tomador.cpf.replace(/\D/g, '')
                  : undefined,
                TomaRazaoSocial: dto.tomador.razaoSocial,
                TomaEndereco: dto.tomador.endereco,
                TomaNumero: dto.tomador.numero,
                TomaBairro: dto.tomador.bairro,
                TomacMun: parseInt(dto.tomador.codigoMunicipio || '0', 10),
                TomaxMun: dto.tomador.municipio,
                TomaUF: dto.tomador.uf,
                TomaCEP:
                  parseInt((dto.tomador.cep || '').replace(/\D/g, ''), 10) || 0,
              },
            },
          ],
        },
      };

      // Chamar API do Invoicy
      const invoicyResponses = await this.invoicyHttpService.emitNfse(
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

      const situacao = doc.Situacao;
      const isAuthorized = situacao?.SitCodigo === 100; // 100 = Autorizada

      // Atualizar NFS-e com resposta
      const updatedNfse = await this.prisma.nfse.update({
        where: { id: nfse.id },
        data: {
          status: isAuthorized ? NfseStatus.AUTHORIZED : NfseStatus.REJECTED,
          numero: doc.NFSe?.NFSeNumero || 0,
          codigoVerificacao: doc.NFSe?.NFSeCodVerificacao || null,
          protocolo: doc.DocProtocolo || null,
          invoicyId: doc.DocIDUnico || null,
          invoicyProtocol: doc.DocProtocolo || null,
          dataEmissao: new Date(),
          pdfUrl: doc.DocPDFDownload || null,
          xmlRetorno: doc.DocXMLBase64,
          motivoRejeicao: !isAuthorized ? situacao?.SitDescricao : null,
        },
      });

      if (!isAuthorized) {
        throw new BadRequestException(
          `NFS-e rejeitada: ${situacao?.SitDescricao || 'Motivo desconhecido'}`,
        );
      }

      return updatedNfse;
    } catch (error) {
      // Atualizar status para rejeitado em caso de erro
      await this.prisma.nfse.update({
        where: { id: nfse.id },
        data: {
          status: NfseStatus.REJECTED,
          motivoRejeicao: error.message,
        },
      });

      this.logger.error(`Erro ao emitir NFS-e: ${error.message}`, error.stack);
      throw new BadRequestException(`Erro ao emitir NFS-e: ${error.message}`);
    }
  }

  async cancel(id: string, companyId: string, dto: CancelNfseDto) {
    const nfse = await this.findById(id, companyId);

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
      const invoicyResponses = await this.invoicyHttpService.cancelNfse(
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
        where: { id },
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

  async consultStatus(id: string, companyId: string) {
    const nfse = await this.findById(id, companyId);

    try {
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
    } catch (error) {
      this.logger.error(
        `Erro ao consultar status da NFS-e: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(
        `Erro ao consultar status da NFS-e: ${error.message}`,
      );
    }
  }

  async getPdfUrl(id: string, companyId: string) {
    const nfse = await this.findById(id, companyId);

    if (!nfse.pdfUrl) {
      // TODO: Buscar PDF da API do Invoicy se não estiver armazenado
      throw new NotFoundException('PDF não disponível para esta NFS-e');
    }

    return { url: nfse.pdfUrl };
  }

  async getXml(id: string, companyId: string) {
    const nfse = await this.findById(id, companyId);

    if (!nfse.xmlRetorno) {
      // TODO: Buscar XML da API do Invoicy se não estiver armazenado
      throw new NotFoundException('XML não disponível para esta NFS-e');
    }

    return { xml: nfse.xmlRetorno };
  }
}
