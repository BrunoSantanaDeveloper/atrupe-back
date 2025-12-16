import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { NfceStatus } from '@prisma/client';
import { InvoicyService } from '../invoicy/invoicy.service';
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

    // Obter próximo número da NFC-e
    const numero = await this.invoicyService.incrementNfceNumber(companyId);

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
      // TODO: Implementar chamada real à API do Invoicy para NFC-e
      this.logger.log(`Emitindo NFC-e ${numero} para empresa ${companyId}`);

      // Simulação de resposta do Invoicy (remover em produção)
      const invoicyResponse = {
        id: `INV-NFCE-${Date.now()}`,
        protocol: `PROT-NFCE-${Date.now()}`,
        chaveAcesso: `${config.emitUf || '43'}${new Date().getFullYear().toString().slice(-2)}${(new Date().getMonth() + 1).toString().padStart(2, '0')}${config.emitCnpj}65${(config.serieNfce || 1).toString().padStart(3, '0')}${numero.toString().padStart(9, '0')}1${Math.random().toString().slice(2, 11)}`,
        status: 'AUTHORIZED',
        qrCodeUrl: `https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx?chave=${Date.now()}`,
        urlConsulta: 'https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx',
        danfeUrl: null,
      };

      // Atualizar NFC-e com resposta
      const updatedNfce = await this.prisma.nfce.update({
        where: { id: nfce.id },
        data: {
          status: NfceStatus.AUTHORIZED,
          chaveAcesso: invoicyResponse.chaveAcesso,
          protocolo: invoicyResponse.protocol,
          invoicyId: invoicyResponse.id,
          invoicyProtocol: invoicyResponse.protocol,
          dataEmissao: new Date(),
          dataAutorizacao: new Date(),
          qrCodeUrl: invoicyResponse.qrCodeUrl,
          urlConsulta: invoicyResponse.urlConsulta,
          danfeUrl: invoicyResponse.danfeUrl,
        },
      });

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
      // TODO: Implementar chamada real à API do Invoicy para cancelamento
      this.logger.log(
        `Cancelando NFC-e ${nfce.numero} para empresa ${companyId}`,
      );

      const updatedNfce = await this.prisma.nfce.update({
        where: { id },
        data: {
          status: NfceStatus.CANCELLED,
          motivoCancelamento: dto.justificativa,
          dataCancelamento: new Date(),
        },
      });

      return updatedNfce;
    } catch (error) {
      this.logger.error(
        `Erro ao cancelar NFC-e: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(
        `Erro ao cancelar NFC-e: ${error.message}`,
      );
    }
  }

  async inutilizar(companyId: string, dto: InutilizarNfceDto) {
    const config = await this.invoicyService.getConfig(companyId);
    if (!config) {
      throw new BadRequestException(
        'Configuração do Invoicy não encontrada.',
      );
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
      // TODO: Implementar chamada real à API do Invoicy para inutilização
      this.logger.log(
        `Inutilizando NFC-e ${dto.numeroInicial} a ${dto.numeroFinal} para empresa ${companyId}`,
      );

      return {
        success: true,
        message: `Numeração ${dto.numeroInicial} a ${dto.numeroFinal} inutilizada com sucesso`,
        numeroInicial: dto.numeroInicial,
        numeroFinal: dto.numeroFinal,
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
      throw new BadRequestException(
        'Configuração do Invoicy não encontrada.',
      );
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
