import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { InvoicyNfeRequest } from '../invoicy/invoicy.types';
import { EmitNfeDto } from './dtos/nfe.dto';
import { fetchCepData } from '../utils/cep.util';

/**
 * NfeBuilderService - Construtor de payload NF-e para Invoicy
 *
 * Este service é responsável por construir o payload complexo
 * necessário para emissão de NF-e via API Invoicy.
 *
 * Separação de responsabilidades:
 * - NfeService: Orquestração e lógica de negócio
 * - NfeBuilderService: Construção de payloads
 */
@Injectable()
export class NfeBuilderService {
  private readonly logger = new Logger(NfeBuilderService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Constrói o request completo para emissão de NF-e no Invoicy
   */
  async buildInvoicyRequest(
    dto: EmitNfeDto,
    config: any,
    numero: number,
  ): Promise<InvoicyNfeRequest> {
    // Buscar código IBGE do destinatário via CEP
    const destResult = await this.getDestinatarioData(dto);

    // Buscar código IBGE do emitente se necessário
    const emitCmun = await this.getEmitenteCmun(config);

    // Calcular valor total
    const valorTotal = this.calcularValorTotal(dto.items);

    const now = new Date();

    return {
      Documento: {
        ModeloDocumento: 'NFe',
        Versao: 4,
        ide: this.buildIdentificacao(dto, config, numero, destResult, now),
        emit: this.buildEmitente(config, emitCmun),
        dest: this.buildDestinatario(dto, destResult, config),
        det: this.buildProdutos(dto.items, destResult.uf, config),
        total: this.buildTotais(valorTotal, dto.items),
        pag: this.buildPagamento(valorTotal, dto.pagamento?.forma),
        transp: { modFrete: '9' },
        ...this.buildCobranca(dto, numero, valorTotal),
        ...this.buildAutXml(dto),
      },
    };
  }

  /**
   * Obtém dados do destinatário incluindo código IBGE via CEP
   */
  private async getDestinatarioData(dto: EmitNfeDto): Promise<{
    cmun: number;
    uf: string;
    municipio: string;
  }> {
    let destCmun = 0;
    let destUf = dto.destUf || '';
    let destMun = dto.destMunicipio || '';

    if (dto.destCep) {
      this.logger.log(`Buscando código IBGE para CEP: ${dto.destCep}`);
      const cepData = await fetchCepData(dto.destCep);
      if (cepData) {
        destCmun = parseInt(cepData.codigoIbge, 10) || 0;
        destUf = cepData.uf;
        destMun = cepData.cidade;
        this.logger.log(
          `Código IBGE do destinatário: ${destCmun} (${destMun}/${destUf})`,
        );
      }
    }

    if (!destCmun) {
      throw new BadRequestException(
        'CEP do destinatário é obrigatório para emissão de NF-e.',
      );
    }

    return { cmun: destCmun, uf: destUf, municipio: destMun };
  }

  /**
   * Obtém código IBGE do emitente
   */
  private async getEmitenteCmun(config: any): Promise<string> {
    let emitCmun = config.ibgeCode;
    const emitCep = config.company?.address?.zipcode;

    if (!emitCmun && emitCep) {
      this.logger.log(`Buscando IBGE do emitente via CEP: ${emitCep}`);
      const cepData = await fetchCepData(emitCep);
      if (cepData) {
        emitCmun = cepData.codigoIbge;
        this.logger.log(`IBGE do emitente: ${emitCmun}`);
      }
    }

    return emitCmun || '0';
  }

  /**
   * Calcula valor total dos itens
   */
  calcularValorTotal(
    items: { quantity: number; unitValue: number; discount?: number }[],
  ): number {
    return items.reduce(
      (acc, item) =>
        acc + item.quantity * item.unitValue - (item.discount || 0),
      0,
    );
  }

  /**
   * Constrói bloco de identificação da NF-e
   */
  private buildIdentificacao(
    dto: EmitNfeDto,
    config: any,
    numero: number,
    dest: { uf: string },
    now: Date,
  ): any {
    return {
      cUF: this.getUfCode(config.company?.address?.state),
      natOp:
        dto.operationNature ||
        config.defaultOperationNature ||
        'Venda de mercadoria',
      mod: '55',
      serie: config.serieNfe?.toString() || '1',
      nNF: numero,
      dhEmi: now.toISOString(),
      fusoHorario: '-03:00',
      tpNf: 1,
      idDest: dest.uf === config.company?.address?.state ? 1 : 2,
      cMunFg: parseInt(config.ibgeCode || '0', 10),
      tpImp: 1,
      tpEmis: 1,
      cDV: 0,
      tpAmb: config.ambiente === 'PRODUCAO' ? 1 : 2,
      finNFe: 1,
      indFinal: dto.destCnpjCpf?.replace(/\D/g, '').length === 11 ? 1 : 0,
      indPres: 1,
      procEmi: 0,
      verProc: 'Atrupe 1.0',
    };
  }

  /**
   * Constrói bloco do emitente
   */
  private buildEmitente(config: any, emitCmun: string): any {
    const company = config.company || {};
    const address = company.address || {};

    return {
      CNPJ_emit: (company.cnpj || '').replace(/\D/g, ''),
      xNome: company.legalName || '',
      IE: (company.stateRegistration || '').replace(/\D/g, ''),
      IM: company.municipalRegistration || undefined,
      CRT: config.emitCrt || 1,
      enderEmit: {
        xLgr: address.street || '',
        nro: address.number || 'S/N',
        xBairro: address.neighborhood || '',
        cMun: parseInt(emitCmun || '0', 10),
        xMun: address.city || '',
        UF: address.state || '',
        CEP: parseInt((address.zipcode || '').replace(/\D/g, ''), 10) || 0,
      },
    };
  }

  /**
   * Constrói bloco do destinatário
   */
  private buildDestinatario(
    dto: EmitNfeDto,
    dest: { cmun: number; uf: string; municipio: string },
    config: any,
  ): any {
    const cleanDoc = dto.destCnpjCpf?.replace(/\D/g, '') || '';
    const isHomologacao =
      config.ambiente === 'HOMOLOGACAO' || config.ambiente !== 1;
    const indIEDest = dto.destIndIEDest ?? 9;

    return {
      ...(cleanDoc.length === 14 ? { CNPJ_dest: cleanDoc } : {}),
      ...(cleanDoc.length === 11 ? { CPF_dest: cleanDoc } : {}),
      xNome_dest: isHomologacao
        ? 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL'
        : dto.destNome || '',
      indIEDest,
      ...(indIEDest === 1 && dto.destIe
        ? { IE_dest: dto.destIe.replace(/\D/g, '') }
        : {}),
      enderDest: {
        xLgr_dest: dto.destEndereco || '',
        nro_dest: dto.destNumero || 'S/N',
        xBairro_dest: dto.destBairro || '',
        cMun_dest: dest.cmun,
        xMun_dest: dest.municipio,
        UF_dest: dest.uf,
        CEP_dest: parseInt((dto.destCep || '').replace(/\D/g, ''), 10) || 0,
        cPais_dest: parseInt(dto.destPais || '1058', 10),
      },
    };
  }

  /**
   * Constrói array de produtos (det)
   */
  private buildProdutos(items: any[], destUf: string, config: any): any[] {
    const emitUf = config.company?.address?.state;

    return items.map((item, index) => ({
      prod: {
        cProd: item.productId || `ITEM${index + 1}`,
        cEAN: this.getEan(item.ean),
        cEANTrib: this.getEan(item.ceantrib),
        xProd: item.description || `Produto ${index + 1}`,
        NCM: (item.ncm || '00000000').replace(/\D/g, ''),
        CFOP: this.getCfop(item.cfop, destUf, emitUf, config.defaultCfop),
        uCOM: item.uCom || 'UN',
        qCOM: item.quantity.toFixed(4),
        vUnCom: item.unitValue.toFixed(10),
        vProd: (item.quantity * item.unitValue).toFixed(2),
        uTrib: item.uCom || 'UN',
        qTrib: item.quantity.toFixed(4),
        vUnTrib: item.unitValue.toFixed(10),
        indTot: 1,
      },
      imposto: {
        ICMS: { orig: 0, CST: item.cstIcms || '102' },
        PIS: { CST_pis: item.cstPis || '49' },
        COFINS: { CST_cofins: item.cstCofins || '49' },
        IPI: { CST_ipi: item.cstIpi || '99' },
      },
    }));
  }

  /**
   * Constrói bloco de totais
   */
  private buildTotais(valorTotal: number, items: any[]): any {
    const valorDesconto = items.reduce((acc, i) => acc + (i.discount || 0), 0);

    return {
      ICMStot: {
        vBC_ttlnfe: '0.00',
        vICMS_ttlnfe: '0.00',
        vICMSDeson_ttlnfe: '0.00',
        vBCST_ttlnfe: '0.00',
        vProd_ttlnfe: valorTotal.toFixed(2),
        vFrete_ttlnfe: '0.00',
        vSeg_ttlnfe: '0.00',
        vDesc_ttlnfe: valorDesconto.toFixed(2),
        vII_ttlnfe: '0.00',
        vIPI_ttlnfe: '0.00',
        vPIS_ttlnfe: '0.00',
        vCOFINS_ttlnfe: '0.00',
        vOutro: '0.00',
        vNF: valorTotal.toFixed(2),
      },
    };
  }

  /**
   * Constrói bloco de pagamento
   */
  private buildPagamento(valorTotal: number, tPag?: string): any[] {
    return [{ tPag: tPag || '99', vPag: valorTotal.toFixed(2) }];
  }

  /**
   * Constrói bloco de cobrança/duplicatas
   */
  private buildCobranca(
    dto: EmitNfeDto,
    numero: number,
    valorTotal: number,
  ): any {
    if (!dto.duplicatas || dto.duplicatas.length === 0) {
      return {};
    }

    return {
      cobr: {
        fat: {
          nFat: numero.toString(),
          vOrig: valorTotal.toFixed(2),
          vDesc: '0.00',
          vLiq: valorTotal.toFixed(2),
        },
        dup: dto.duplicatas.map((d) => ({
          nDup: d.numero || '',
          dVenc: d.dataVencimento || '',
          vDup: (d.valor || 0).toFixed(2),
        })),
      },
    };
  }

  /**
   * Constrói bloco de autorização XML
   */
  private buildAutXml(dto: EmitNfeDto): any {
    if (!dto.autXml || dto.autXml.length === 0) {
      return {};
    }

    return {
      autXML: dto.autXml.map((doc) => {
        const cleanDoc = doc.replace(/\D/g, '');
        return cleanDoc.length === 14 ? { CNPJ: cleanDoc } : { CPF: cleanDoc };
      }),
    };
  }

  /**
   * Helper: Valida e retorna EAN
   */
  private getEan(ean?: string): string {
    if (ean && /^\d+$/.test(ean) && [8, 12, 13, 14].includes(ean.length)) {
      return ean;
    }
    return 'SEM GTIN';
  }

  /**
   * Helper: Calcula CFOP correto baseado em operação interna/interestadual
   */
  private getCfop(
    cfop: number | undefined,
    destUf: string,
    emitUf: string,
    defaultCfop: string,
  ): number {
    const baseCfop = cfop || parseInt(defaultCfop || '5102', 10);
    const isInterestadual = destUf !== emitUf;

    // 5xxx -> 6xxx para interestadual
    if (isInterestadual && Math.floor(baseCfop / 1000) === 5) {
      return baseCfop + 1000;
    }

    // 6xxx -> 5xxx para operação interna
    if (!isInterestadual && Math.floor(baseCfop / 1000) === 6) {
      return baseCfop - 1000;
    }

    return baseCfop;
  }

  /**
   * Helper: Código numérico da UF
   */
  getUfCode(uf: string): number {
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
}
