/**
 * Invoicy API Type Definitions
 * Based on Invoicy REST API documentation and Postman collections
 */
import type { GrupoIbsCbs } from '../utils/ibs-cbs-nfe.util';

// ============================================
// Authentication Types
// ============================================

export interface InvoicyAuthRequest {
  sub: string; // CNPJ da empresa emitente
  partnerKey: string; // Chave do parceiro (Atrupe)
  chaveAcesso: string; // Chave de acesso da empresa
}

export interface InvoicyAuthResponse {
  accessToken: string;
  accessTokenExpireAt: number; // Unix timestamp
  refreshToken: string;
  refreshTokenExpireAt: number;
}

export interface InvoicyTokenCache {
  token: string;
  expiresAt: number;
  companyId: string;
  credentialsHash?: string;
}

// ============================================
// Common Types
// ============================================

export type InvoicyEnvironment = 'HOMOLOGACAO' | 'PRODUCAO';

export interface InvoicyApiConfig {
  baseUrl: string;
  partnerKey: string;
  environment: InvoicyEnvironment;
}

// ============================================
// Document Response Types
// ============================================

export interface InvoicyDocumentSituacao {
  SitCodigo: number;
  SitDescricao: string;
}

export interface InvoicyDocumentNfse {
  NFSeNumero: number;
  NFSeCodVerificacao: string;
  NFSeDataEmissao: string;
}

/**
 * Evento vinculado a um documento, como devolvido pela consulta com
 * ParmEventos=S. Os nomes seguem o layout publicado pela Migrate em
 * migrate-company/integracao-InvoiCy-BR (webhook/Exemplos JSON).
 */
export interface InvoicyDocumentEvent {
  DocEvenSeq: string | number;
  DocEveTp: string | number;
  DocEveXML: string;
  DocEveXMLLink: string;
  cStat: string | number;
  DocEveDescricao: string;
  DocEveId: string;
  DocEveArqNome: string;
  DocEveArqExtensao: string;
  /** DACCE em base64 — so' vem preenchido com ParmPDFBase64=S. */
  DocEvePDF: string;
  DocEvePDFLink: string;
  DocEveProtocolo: string;
  DocEveDhReg: string;
}

export interface InvoicyDocumentResult {
  DocModelo: 'NFe' | 'NFCe' | 'NFSE';
  DocNumero: number;
  DocSerie: string;
  DocIDUnico: string;
  DocChaAcesso: string;
  DocProtocolo: string;
  DocEvenSeq: number;
  DocEveTp: number;
  DocEveId: string;
  DocPDFBase64: string;
  DocPDFDownload: string;
  DocDhAut: string;
  DocDigestValue: string;
  DocXMLBase64: string;
  DocXMLDownload: string;
  /**
   * A consulta GET (type=Consulta) devolve o mesmo conteudo com outros nomes:
   * DocXML (base64) e DocXMLLink. Tratados como sinonimos de DocXMLBase64 e
   * DocXMLDownload.
   */
  DocXML?: string;
  DocXMLLink?: string;
  DocImpressora: string;
  Situacao: InvoicyDocumentSituacao;
  Eventos?: InvoicyDocumentEvent[];
  MensagemSefaz: {
    CodMsg: number;
    DscMsg: string;
  };
  NFSe: InvoicyDocumentNfse;
  DocImpPrefeitura: string;
  DocCompleto: string;
}

export interface InvoicyResponse {
  Codigo: number;
  Descricao: string;
  ErrorInvoicy?: string;
  Documentos?: InvoicyDocumentResult[];
}

// ============================================
// NF-e Request Types
// ============================================

export interface InvoicyNfeIde {
  cUF: number; // Código da UF
  natOp: string; // Natureza da operação
  mod: string; // Modelo (55 = NF-e)
  serie: string;
  nNF: number;
  dhEmi: string; // Data/hora emissão ISO 8601
  dhSaiEnt?: string; // Data/hora saida ou entrada
  fusoHorario: string;
  tpNf: number; // 0 = Entrada, 1 = Saída
  idDest: number; // 1 = Operação interna
  cMunFg: number; // Código município
  tpImp: number; // Tipo impressão DANFE
  tpEmis: number; // Tipo emissão
  cDV: number;
  tpAmb: number; // 1 = Produção, 2 = Homologação
  finNFe: number; // 1 = Normal
  indFinal: number; // 0 = Não, 1 = Consumidor final
  indPres: number; // Indicador presença
  procEmi: number;
  verProc: string;
  // Caixa do contrato do provedor (`NFRef`), nao a da tag XML da SEFAZ
  // (`NFref`): com a grafia do XML a chave era ignorada. O `NFRefItem` do XSD
  // fica implicito no array.
  NFRef?: Array<{ refNFe: string }>;
  idCSC?: number;
  CSC?: string;
  dhCont?: string;
  xJust?: string;
}

export interface InvoicyNfeEnderEmit {
  xLgr: string;
  nro: string;
  xBairro: string;
  cMun: number;
  xMun: string;
  UF: string;
  CEP: number;
}

export interface InvoicyNfeEmit {
  CNPJ_emit: string;
  xNome: string;
  IE: string;
  IM?: string;
  CRT: number; // 1 = Simples, 2 = SN Excesso, 3 = Normal
  enderEmit: InvoicyNfeEnderEmit;
}

export interface InvoicyNfeEnderDest {
  xLgr_dest: string;
  nro_dest: string;
  xBairro_dest: string;
  cMun_dest: number;
  xMun_dest: string;
  UF_dest: string;
  CEP_dest?: number;
  cPais_dest: number;
}

export interface InvoicyNfeDest {
  CNPJ_dest?: string;
  CPF_dest?: string;
  idEstrangeiro?: string;
  xNome_dest: string;
  indIEDest: number;
  enderDest?: InvoicyNfeEnderDest;
}

export interface InvoicyNfeProd {
  cProd: string;
  cEAN: string;
  cEANTrib: string;
  xProd: string;
  NCM: string;
  CFOP: number;
  uCOM: string;
  qCOM: string;
  vUnCom: string;
  vProd: string;
  uTrib: string;
  qTrib: string;
  vUnTrib: string;
  indTot: number;
}

/**
 * Grupo de impostos do item.
 *
 * Os nomes seguem o schema `Invoicy_NFe-NFCe v4.00.xsd`, que usa sufixos: o
 * valor do ICMS próprio é `vICMS_icms`, e o IPI fica em `CSTIPI` com `cEnq` ao
 * lado. Nome divergente não gera erro — o provedor ignora o campo e a nota sai
 * sem o imposto destacado.
 *
 * Os campos de valor são opcionais porque o Simples Nacional envia apenas os
 * códigos: a apuração dele é no documento único de arrecadação, não na nota.
 */
export interface InvoicyNfeImposto {
  ICMS: {
    orig: number;
    CST: string;
    /** Modalidade da base; 3 = valor da operação. */
    modBC?: number;
    vBC?: number;
    /** Percentual de redução da base (CST 20). */
    pRedBC?: number;
    pICMS?: number;
    /** Valor do ICMS próprio. O sufixo é do layout, não engano. */
    vICMS_icms?: number;
    /** Fundo de Combate à Pobreza sobre o ICMS próprio (tags N17a-N17c). */
    vBCFCP?: number;
    pFCP?: number;
    vFCP?: number;
    pCredSN?: string;
    vCredICMSSN?: string;
    /** Substituição tributária. modBCST 4 = margem de valor agregado. */
    modBCST?: number;
    pMVAST?: number;
    pRedBCST?: number;
    vBCST?: number;
    pICMSST?: number;
    /** Valor do ICMS-ST. O sufixo é do layout, como em vICMS_icms. */
    vICMSST_icms?: number;
    vBCFCPST?: number;
    pFCPST?: number;
    vFCPST?: number;
  };
  PIS: {
    CST_pis: string;
    vBC_pis?: number;
    pPIS?: number;
    vPIS?: number;
  };
  COFINS: {
    CST_cofins: string;
    vBC_cofins?: number;
    pCOFINS?: number;
    vCOFINS?: number;
  };
  IPI?: {
    /** Código de enquadramento legal; 999 = tributação normal. */
    cEnq: string;
    CSTIPI: {
      CST_IPI: string;
      vBC_IPI?: number;
      pIPI?: number;
      vIPI?: number;
    };
  };
  /**
   * Grupo IBS/CBS da Reforma Tributária. Só existe no layout paralelo do
   * provedor: enviar sem a Reforma ativa para a empresa é campo ignorado.
   */
  IBSCBS?: GrupoIbsCbs;
  /** DIFAL da EC 87/15 — venda interestadual a consumidor final não contribuinte. */
  ICMSUFDest?: {
    vBCUFDest: number;
    pICMSUFDest: number;
    pICMSInter: number;
    pICMSInterPart: number;
    vICMSUFDest: number;
    vICMSUFRemet: number;
    vBCFCPUFDest?: number;
    pFCPUFDest?: number;
    vFCPUFDest?: number;
  };
}

export interface InvoicyNfeDet {
  prod: InvoicyNfeProd;
  imposto: InvoicyNfeImposto;
}

export interface InvoicyNfeTotal {
  ICMStot: {
    vBC_ttlnfe: string;
    vICMS_ttlnfe: string;
    vICMSDeson_ttlnfe: string;
    vBCST_ttlnfe: string;
    vProd_ttlnfe: string;
    vFrete_ttlnfe: string;
    vSeg_ttlnfe: string;
    vDesc_ttlnfe: string;
    vII_ttlnfe: string;
    vIPI_ttlnfe: string;
    vPIS_ttlnfe: string;
    vCOFINS_ttlnfe: string;
    vOutro: string;
    vNF: string;
  };
}

export interface InvoicyNfePag {
  tPag: string; // 01 = Dinheiro, 02 = Cheque, 03 = Cartão Crédito, etc.
  vPag: string;
}

export interface InvoicyNfeDup {
  nDup: string;
  dVenc: string;
  vDup: string;
}

export interface InvoicyNfeCobr {
  fat?: {
    nFat: string;
    vOrig: string;
    vDesc: string;
    vLiq: string;
  };
  dup: InvoicyNfeDup[];
}

export interface InvoicyNfeAut {
  CNPJ?: string;
  CPF?: string;
}

export interface InvoicyNfeEntrega {
  CNPJ_entrega?: string;
  CPF_entrega?: string;
  xLgr_entrega: string;
  nro_entrega: string;
  xCpl_entrega?: string;
  xBairro_entrega: string;
  cMun_entrega: number;
  xMun_entrega: string;
  UF_entrega: string;
  CEP_entrega?: number;
}

export interface InvoicyNfeDocumento {
  ModeloDocumento: 'NFe' | 'NFCe';
  Versao: number;
  ide: InvoicyNfeIde;
  emit: InvoicyNfeEmit;
  dest?: InvoicyNfeDest;
  entrega?: InvoicyNfeEntrega;
  det: InvoicyNfeDet[];
  total: InvoicyNfeTotal;
  pag: InvoicyNfePag[];
  /**
   * Troco da NFC-e (soma de vPag − vNF). No leiaute do InvoiCy fica fora do
   * grupo `pag`, logo depois dele; sem ele, pagamento maior que a nota é
   * rejeitado pela SEFAZ.
   */
  vTroco?: string;
  transp?: {
    modFrete: string;
  };
  cobr?: InvoicyNfeCobr;
  autXML?: InvoicyNfeAut[];
  /** Informações complementares (texto livre impresso na DANFE). */
  infAdic?: { infCpl: string };
}

export interface InvoicyNfeRequest {
  Documento: InvoicyNfeDocumento;
}

// ============================================
// NFS-e Request Types
// ============================================

export interface InvoicyNfsePrestador {
  CNPJ_prest: string;
  xNome: string;
  xFant?: string;
  IM?: string;
  IE?: string;
  enderPrest: {
    TPEnd?: string;
    xLgr: string;
    nro: string;
    xBairro: string;
    cMun: number;
    UF: string;
    CEP: number;
  };
}

export interface InvoicyNfseTomador {
  TomaCNPJ?: string;
  TomaCPF?: string;
  TomaIdEstrangeiro?: string;
  TomaRazaoSocial: string;
  TomatpLgr?: string;
  TomaEndereco: string;
  TomaNumero: string;
  TomaBairro: string;
  TomacMun: number;
  TomaxMun: string;
  TomaUF: string;
  TomaCEP: number;
  TomacPais?: number;
}

export interface InvoicyNfseListaItem {
  ItemSeq: number;
  ItemCod: string;
  ItemDesc: string;
  ItemQtde: number;
  ItemvUnit: number;
  ItemuMed: string;
  ItemvlDed: number;
  ItemTributavel: string;
  ItemcCnae?: number;
  /** Código de tributação no município (C(20), ex. "001"). */
  ItemTributMunicipio: string | number;
  ItemvIss: number;
  /** Omitido para ME/EPP do Simples sem retenção de ISSQN — ver E0625. */
  ItemAliquota?: number;
  ItemVlrTotal: number;
  ItemBaseCalculo: number;
  ItemIssRetido: number;
  ItemIteListServico: number;
  ItemExigibilidadeISS: number;
  ItemcMunIncidencia: number;
}

export interface InvoicyNfseServico {
  Valores: {
    ValServicos: number;
    ValDeducoes: number;
    ValPIS: number;
    ValCOFINS: number;
    ValINSS: number;
    ValIR: number;
    ValCSLL: number;
    ISSRetido: number;
    ValISS: number;
    ValOutrasRetencoes: number;
    ValBaseCalculo: number;
    /** Omitida para ME/EPP do Simples sem retenção de ISSQN — ver E0625. */
    ValAliqISS?: number;
    /** Valor monetário aproximado dos tributos federais (Modelo Nacional). */
    ValRetFederais?: number;
    /** Valor monetário aproximado dos tributos estaduais (Modelo Nacional). */
    ValRetEstaduais?: number;
    /** Valor monetário aproximado dos tributos municipais (Modelo Nacional). */
    ValRetMunicipais?: number;
    /** Alíquota do INSS em decimal: 0,05 = 5%. */
    ValAliqINSS?: number;
  };
  LocalPrestacao?: {
    SerEndTpLgr: string;
    SerEndLgr: string;
    SerEndNumero: string;
    SerEndBairro: string;
    SerEndxMun: string;
    SerEndcMun: number;
    SerEndCep: number;
    SerEndSiglaUF: string;
  };
  IteListServico: number;
  Cnae?: number;
  fPagamento?: number;
  /** Código de tributação no município (C(20), ex. "001"). */
  TributMunicipio: string | number;
  Discriminacao: string;
  cMun: number;
  /** Nomenclatura Brasileira de Serviços. */
  CodigoNBS?: string;
  /** Código de tributação nacional do serviço. */
  codTributNacional?: string;
  /**
   * Bloco da Reforma Tributária. Hoje só a classificação tributária é
   * preenchida, a partir do cadastro do serviço; CST e os demais campos ainda
   * não são coletados.
   */
  IBSCBS?: {
    cClassTrib?: string;
    CSTIBSCBS?: string;
  };
}

export interface InvoicyNfseRps {
  RPSNumero: string;
  RPSSerie: string;
  RPSTipo: number;
  dEmis: string;
  dCompetencia: string;
  LocalPrestServ: number;
  natOp: number;
  Operacao?: number;
  RegEspTrib?: number;
  OptSN: number; // 1 = optante do Simples Nacional, 2 = não optante
  // Obrigatório para ME/EPP optante do SN. 1 = tributos federais e municipais
  // apurados pelo SN, 2 = ISSQN por fora do SN, 3 = federais e municipais por fora.
  regApTribSN?: number;
  /**
   * Regime de apuração do IBS/CBS: 1 = ambos pelo Simples, 2 = CBS pelo
   * Simples e IBS regular, 3 = ambos pelo regime regular.
   */
  regApIBSCBSSN?: number;
  // ── Reforma Tributária (Layout_Recepcao_NFSe_Reforma_Tributaria v8) ──
  /** Código indicador da operação, tabela Anexo VII (6 dígitos). */
  cIndOp?: string;
  /** Operação de uso ou consumo pessoal: 0=Não, 1=Sim. */
  indFinal?: number;
  /** Destinatário: 0=tomador é o destinatário, 1=destinatário diverso. */
  indDest?: number;
  /** Ente governamental: 1=União, 2=Estado, 3=DF, 4=Município (9=outro só no padrão IPM). */
  tpEnteGov?: number;
  /** Descrição do ente quando tpEnteGov=9. */
  xTpEnteGov?: string;
  /** Operação com entes governamentais ou serviços sobre bens imóveis (1..5); independe de tpEnteGov. */
  tpOper?: number;
  IncCult: number;
  Status: number;
  tpAmb: number;
  /** Finalidade da NFS-e: 0 = regular, 1 = crédito, 2 = débito. 1-1 no layout. */
  finNFSe?: number;
  Prestador: InvoicyNfsePrestador;
  ListaItens: InvoicyNfseListaItem[];
  Servico: InvoicyNfseServico;
  Tomador: InvoicyNfseTomador;
}

export interface InvoicyNfseDocumento {
  ModeloDocumento: 'NFSE';
  Versao: number;
  RPS: InvoicyNfseRps[];
}

export interface InvoicyNfseRequest {
  Documento: InvoicyNfseDocumento;
}

// ============================================
// Error Codes
// ============================================

export const INVOICY_SUCCESS_CODES = {
  DOCUMENTS_PROCESSED: 100,
};

/**
 * Estes nomes são LEITURA NOSSA dos códigos do provedor, não documentação dele:
 * não há tabela oficial versionada neste repositório. O 606 já foi chamado de
 * COMPANY_NOT_ENABLED e a mensagem correspondente mandava o usuário reativar o
 * emissor; em 05/08/2026 isso foi provado falso (empresa autenticando, emitindo
 * e consultando normalmente no mesmo ambiente que devolveu 606 numa CC-e).
 * Antes de mapear qualquer código novo para uma causa, confirme com o suporte
 * do Invoicy e registre a fonte aqui.
 */
export const INVOICY_ERROR_CODES = {
  INVALID_KEY: 173,
  REJECTED_BY_SEFAZ: 225,
  /** Significado real desconhecido. Ver comentário acima antes de usar. */
  UNSPECIFIED_606: 606,
};
