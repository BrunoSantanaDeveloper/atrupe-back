import { Injectable, Logger } from '@nestjs/common';
import { InvoicyNfseRequest } from '../invoicy/invoicy.types';
import { EmitNfseDto } from './dtos/nfse.dto';

/**
 * NfseBuilderService - Construção de payloads para Invoicy NFS-e
 *
 * Responsável por construir o payload complexo do Invoicy:
 * - RPS (Recibo Provisório de Serviço)
 * - Lista de itens
 * - Dados do prestador
 * - Dados do tomador
 * - Valores e tributos
 */
@Injectable()
export class NfseBuilderService {
  private readonly logger = new Logger(NfseBuilderService.name);

  /**
   * Constrói o request completo para a API do Invoicy
   */
  buildInvoicyRequest(
    dto: EmitNfseDto,
    config: any,
    rpsNumero: number,
    valorIss: number,
    baseCalculo: number,
  ): InvoicyNfseRequest {
    const rpsSerie = config.serieNfse || 'A1';
    const valorServicos = dto.valorServicos;
    const valorDeducoes = dto.valorDeducoes || 0;
    const aliquotaIss = dto.aliquotaIss || config.aliquotaIss || 0;

    const listaItens = this.buildListaItens(
      dto,
      config,
      valorServicos,
      valorDeducoes,
      valorIss,
      aliquotaIss,
      baseCalculo,
    );

    return {
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
            LocalPrestServ:
              dto.entregaCodigoMunicipio &&
              dto.entregaCodigoMunicipio !==
                (config.ibgeCode || config.emitCmun)
                ? 2
                : 1,
            natOp: dto.naturezaOperacao || 1, // 1 = Tributação no município
            Operacao: 1,
            RegEspTrib: 1, // 1 = Nenhum
            // Invoicy: 1=Não optante→opSimpNac:3, 2=ME→opSimpNac:1, 3=EPP→opSimpNac:2
            OptSN: config.emitCrt === 1 ? 2 : 1,
            IncCult: 2, // 2 = Não
            Status: 1, // 1 = Normal
            tpAmb:
              config.ambiente === 1 || config.environment === 'PRODUCAO'
                ? 1
                : 2,
            Prestador: this.buildPrestador(config),
            ListaItens: listaItens,
            Servico: this.buildServico(
              dto,
              config,
              valorServicos,
              valorDeducoes,
              valorIss,
              aliquotaIss,
              baseCalculo,
            ),
            Tomador: this.buildTomador(dto),
          },
        ],
      },
    };
  }

  /**
   * Constrói lista de itens do serviço
   */
  private buildListaItens(
    dto: EmitNfseDto,
    config: any,
    valorServicos: number,
    valorDeducoes: number,
    valorIss: number,
    aliquotaIss: number,
    baseCalculo: number,
  ): any[] {
    if (dto.itens && dto.itens.length > 0) {
      return dto.itens.map((item, index) => ({
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
        ),
        ItemExigibilidadeISS: 1, // Exigível
        ItemcMunIncidencia: parseInt(
          dto.codigoMunicipio || config.ibgeCode || '0',
          10,
        ),
      }));
    }

    // Item padrão quando não há lista de itens
    return [
      {
        ItemSeq: 1,
        ItemCod: 'SERV',
        ItemDesc: dto.discriminacao.substring(0, 100),
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
        ItemIteListServico: parseInt(dto.codigoServico.replace(/\D/g, ''), 10),
        ItemExigibilidadeISS: 1,
        ItemcMunIncidencia: parseInt(
          dto.codigoMunicipio || config.ibgeCode || '0',
          10,
        ),
      },
    ];
  }

  /**
   * Constrói dados do prestador (empresa emissora)
   */
  private buildPrestador(config: any): any {
    const municipalRegistration = (
      config.company.municipalRegistration || ''
    ).replace(/\D/g, '');

    return {
      CNPJ_prest: (config.company.cnpj || '').replace(/\D/g, ''),
      xNome: config.company.legalName || '',
      xFant: config.company.name || '',
      ...(municipalRegistration ? { IM: municipalRegistration } : {}),
      enderPrest: {
        TPEnd: 'Rua',
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
    };
  }

  /**
   * Constrói dados do serviço
   */
  private buildServico(
    dto: EmitNfseDto,
    config: any,
    valorServicos: number,
    valorDeducoes: number,
    valorIss: number,
    aliquotaIss: number,
    baseCalculo: number,
  ): any {
    return {
      Valores: {
        ValServicos: valorServicos,
        ValDeducoes: valorDeducoes,
        ValPIS: dto.valorPis || 0,
        ValCOFINS: dto.valorCofins || 0,
        ValINSS: dto.valorInss || 0,
        ValIR: dto.valorIr || 0,
        ValCSLL: dto.valorCsll || 0,
        ISSRetido: dto.issRetido ? 1 : 2,
        ValISS: valorIss,
        ValOutrasRetencoes: 0,
        ValBaseCalculo: baseCalculo,
        ValAliqISS: aliquotaIss,
      },
      IteListServico: parseInt(dto.codigoServico.replace(/\D/g, ''), 10),
      Discriminacao: dto.discriminacao,
      cMun: parseInt(dto.codigoMunicipio || config.ibgeCode || '0', 10),
      TributMunicipio: parseInt(
        dto.codigoMunicipio || config.ibgeCode || '0',
        10,
      ),
      ...(dto.entregaEndereco
        ? {
            LocalPrestacao: {
              SerEndTpLgr: 'Rua',
              SerEndLgr: dto.entregaEndereco,
              SerEndNumero: dto.entregaNumero || 'S/N',
              SerEndBairro: dto.entregaBairro || '',
              SerEndxMun: dto.entregaMunicipio || '',
              SerEndcMun: parseInt(dto.entregaCodigoMunicipio || '0', 10) || 0,
              SerEndCep:
                parseInt((dto.entregaCep || '').replace(/\D/g, ''), 10) || 0,
              SerEndSiglaUF: dto.entregaUf || '',
            },
          }
        : {}),
    };
  }

  /**
   * Constrói dados do tomador (cliente)
   */
  private buildTomador(dto: EmitNfseDto): any {
    const isForeign =
      dto.tomador.codigoPais && dto.tomador.codigoPais !== '1058';

    return {
      ...(isForeign
        ? { TomaIdEstrangeiro: dto.tomador.idEstrangeiro || 'ESTRANGEIRO' }
        : {
            TomaCNPJ: dto.tomador.cnpj
              ? dto.tomador.cnpj.replace(/\D/g, '')
              : undefined,
            TomaCPF: dto.tomador.cpf
              ? dto.tomador.cpf.replace(/\D/g, '')
              : undefined,
          }),
      TomaRazaoSocial: dto.tomador.razaoSocial,
      TomaEndereco: dto.tomador.endereco,
      TomaNumero: dto.tomador.numero,
      TomaBairro: isForeign ? undefined : dto.tomador.bairro,
      TomacMun: isForeign
        ? 9999999
        : parseInt(dto.tomador.codigoMunicipio || '0', 10),
      TomaxMun: isForeign
        ? dto.tomador.municipio || 'EXTERIOR'
        : dto.tomador.municipio,
      TomaUF: isForeign ? 'EX' : dto.tomador.uf,
      TomaCEP: isForeign
        ? 0
        : parseInt((dto.tomador.cep || '').replace(/\D/g, ''), 10) || 0,
      ...(isForeign ? { TomacPais: parseInt(dto.tomador.codigoPais, 10) } : {}),
    };
  }
}
