import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { NfeStatus } from '@prisma/client';
import { InvoicyService } from '../invoicy/invoicy.service';
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
  ) {}

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
        valorTotal: dto.items.reduce(
          (acc, item) =>
            acc + item.quantity * item.unitValue - (item.discount || 0),
          0,
        ),
      },
    });

    try {
      // TODO: Implementar chamada real à API do Invoicy
      this.logger.log(`Emitindo NF-e ${numero} para empresa ${companyId}`);

      // Simulação de resposta do Invoicy (remover em produção)
      const invoicyResponse = {
        id: `INV-${Date.now()}`,
        protocol: `PROT-${Date.now()}`,
        chaveAcesso: `${config.emitUf}${new Date().getFullYear().toString().slice(-2)}${new Date().getMonth().toString().padStart(2, '0')}${config.emitCnpj}55${config.serieNfe.toString().padStart(3, '0')}${numero.toString().padStart(9, '0')}1${Math.random().toString().slice(2, 11)}`,
        status: 'AUTHORIZED',
        danfeUrl: null,
      };

      // Atualizar NF-e com resposta
      const updatedNfe = await this.prisma.nfe.update({
        where: { id: nfe.id },
        data: {
          status: NfeStatus.AUTHORIZED,
          chaveAcesso: invoicyResponse.chaveAcesso,
          protocolo: invoicyResponse.protocol,
          invoicyId: invoicyResponse.id,
          invoicyProtocol: invoicyResponse.protocol,
          dataEmissao: new Date(),
          dataAutorizacao: new Date(),
          danfeUrl: invoicyResponse.danfeUrl,
        },
      });

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
      // TODO: Implementar chamada real à API do Invoicy para cancelamento
      this.logger.log(
        `Cancelando NF-e ${nfe.numero} para empresa ${companyId}`,
      );

      const updatedNfe = await this.prisma.nfe.update({
        where: { id },
        data: {
          status: NfeStatus.CANCELLED,
          motivoCancelamento: dto.justificativa,
          dataCancelamento: new Date(),
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
      // TODO: Implementar chamada real à API do Invoicy para carta de correção
      this.logger.log(`Enviando carta de correção para NF-e ${nfe.numero}`);

      const updatedNfe = await this.prisma.nfe.update({
        where: { id },
        data: {
          status: NfeStatus.CORRECTION_SENT,
          cartaCorrecao: dto.correcao,
          dataCorrecao: new Date(),
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
