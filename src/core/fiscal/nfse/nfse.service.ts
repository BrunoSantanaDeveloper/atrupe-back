import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { NfseStatus } from '@prisma/client';
import { InvoicyService } from '../invoicy/invoicy.service';
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
    const valorServicos = quotation.quotationProduct.reduce(
      (acc: number, qp) => acc + (qp.finalValue || qp.totalValue || 0),
      0,
    );

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
      codigoMunicipio: config.emitCmun || '',
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
        codigoMunicipio: config.emitCmun || '',
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

    if (!config.emitIm) {
      throw new BadRequestException(
        'Inscrição Municipal não configurada. Necessária para emissão de NFS-e.',
      );
    }

    // Obter próximo número do RPS
    const rpsNumero = await this.invoicyService.incrementNfseRpsNumber(
      companyId,
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
      // TODO: Implementar chamada real à API do Invoicy para NFS-e
      this.logger.log(
        `Emitindo NFS-e (RPS ${rpsNumero}) para empresa ${companyId}`,
      );

      // Simulação de resposta do Invoicy (remover em produção)
      const invoicyResponse = {
        id: `INV-NFSE-${Date.now()}`,
        protocol: `PROT-NFSE-${Date.now()}`,
        numero: Math.floor(Math.random() * 1000000),
        codigoVerificacao: `VRF-${Date.now().toString(36).toUpperCase()}`,
        status: 'AUTHORIZED',
        pdfUrl: null,
      };

      // Atualizar NFS-e com resposta
      const updatedNfse = await this.prisma.nfse.update({
        where: { id: nfse.id },
        data: {
          status: NfseStatus.AUTHORIZED,
          numero: invoicyResponse.numero,
          codigoVerificacao: invoicyResponse.codigoVerificacao,
          protocolo: invoicyResponse.protocol,
          invoicyId: invoicyResponse.id,
          invoicyProtocol: invoicyResponse.protocol,
          dataEmissao: new Date(),
          pdfUrl: invoicyResponse.pdfUrl,
        },
      });

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
      // TODO: Implementar chamada real à API do Invoicy para cancelamento de NFS-e
      this.logger.log(
        `Cancelando NFS-e ${nfse.numero} para empresa ${companyId}`,
      );

      const updatedNfse = await this.prisma.nfse.update({
        where: { id },
        data: {
          status: NfseStatus.CANCELLED,
          motivoCancelamento: dto.justificativa,
          dataCancelamento: new Date(),
        },
      });

      return updatedNfse;
    } catch (error) {
      this.logger.error(
        `Erro ao cancelar NFS-e: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(
        `Erro ao cancelar NFS-e: ${error.message}`,
      );
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
