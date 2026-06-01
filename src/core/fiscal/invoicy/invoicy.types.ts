/**
 * Invoicy API Type Definitions
 * Based on Invoicy REST API documentation and Postman collections
 */

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
  DocImpressora: string;
  Situacao: InvoicyDocumentSituacao;
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
  NFref?: Array<{ refNFe: string }>;
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
  enderDest: InvoicyNfeEnderDest;
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

export interface InvoicyNfeImposto {
  ICMS: {
    orig: number;
    CST: string;
    pCredSN?: string;
    vCredICMSSN?: string;
  };
  PIS: {
    CST_pis: string;
  };
  COFINS: {
    CST_cofins: string;
  };
  IPI?: {
    CST_ipi: string;
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

export interface InvoicyNfeDocumento {
  ModeloDocumento: 'NFe' | 'NFCe';
  Versao: number;
  ide: InvoicyNfeIde;
  emit: InvoicyNfeEmit;
  dest: InvoicyNfeDest;
  det: InvoicyNfeDet[];
  total: InvoicyNfeTotal;
  pag: InvoicyNfePag[];
  transp?: {
    modFrete: string;
  };
  cobr?: InvoicyNfeCobr;
  autXML?: InvoicyNfeAut[];
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
  IM: string;
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
  ItemTributMunicipio: number;
  ItemvIss: number;
  ItemAliquota: number;
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
    ValAliqISS: number;
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
  TributMunicipio: number;
  Discriminacao: string;
  cMun: number;
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
  OptSN: number;
  IncCult: number;
  Status: number;
  tpAmb: number;
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

export const INVOICY_ERROR_CODES = {
  INVALID_KEY: 173,
  COMPANY_NOT_ENABLED: 606,
  REJECTED_BY_SEFAZ: 225,
};
