/**
 * Validadores Fiscais - NCM, CFOP, CST e outros códigos fiscais
 *
 * Implementa validações para evitar rejeições na SEFAZ/Prefeitura
 */

export interface ValidationResult {
  valid: boolean;
  message?: string;
}

// ==================== NCM ====================

/**
 * Valida NCM (Nomenclatura Comum do Mercosul)
 *
 * Regras:
 * - Deve ter exatamente 8 dígitos numéricos
 * - Não pode ser 00000000 (exceto para serviços)
 * - Primeiro dígito indica o capítulo (01-99)
 *
 * @example validateNcm('12345678') // { valid: true }
 * @example validateNcm('1234567')  // { valid: false, message: 'NCM deve ter 8 dígitos' }
 */
export function validateNcm(
  ncm: string,
  allowGeneric = false,
): ValidationResult {
  if (!ncm) {
    return { valid: false, message: 'NCM é obrigatório' };
  }

  // Remove caracteres não numéricos
  const cleanNcm = ncm.replace(/\D/g, '');

  if (cleanNcm.length !== 8) {
    return { valid: false, message: 'NCM deve ter 8 dígitos' };
  }

  if (!allowGeneric && cleanNcm === '00000000') {
    return { valid: false, message: 'NCM genérico não permitido' };
  }

  // Valida capítulo (primeiros 2 dígitos devem ser 01-99) - skip for generic
  if (!allowGeneric || cleanNcm !== '00000000') {
    const capitulo = parseInt(cleanNcm.substring(0, 2), 10);
    if (capitulo < 1 || capitulo > 99) {
      return {
        valid: false,
        message: 'NCM inválido: capítulo deve ser entre 01 e 99',
      };
    }
  }

  return { valid: true };
}

/**
 * Formata NCM para o padrão sem pontuação (8 dígitos)
 */
export function formatNcm(ncm: string): string {
  return (ncm || '').replace(/\D/g, '').padStart(8, '0').substring(0, 8);
}

// ==================== CFOP ====================

/**
 * CFOPs válidos agrupados por tipo de operação
 */
export const CFOP_GROUPS = {
  // Entradas dentro do estado
  ENTRADA_ESTADO: [
    '1000',
    '1101',
    '1102',
    '1111',
    '1113',
    '1116',
    '1117',
    '1118',
    '1120',
    '1121',
    '1122',
    '1124',
    '1125',
    '1126',
    '1151',
    '1152',
    '1153',
    '1154',
    '1201',
    '1202',
    '1203',
    '1204',
    '1205',
    '1206',
    '1207',
    '1208',
    '1209',
    '1251',
    '1252',
    '1253',
    '1254',
    '1255',
    '1256',
    '1257',
    '1301',
    '1302',
    '1303',
    '1304',
    '1305',
    '1306',
    '1351',
    '1352',
    '1353',
    '1354',
    '1355',
    '1356',
    '1401',
    '1403',
    '1406',
    '1407',
    '1408',
    '1409',
    '1410',
    '1411',
    '1414',
    '1415',
    '1451',
    '1452',
    '1501',
    '1503',
    '1504',
    '1505',
    '1506',
    '1551',
    '1552',
    '1553',
    '1554',
    '1555',
    '1556',
    '1557',
    '1601',
    '1602',
    '1603',
    '1604',
    '1605',
    '1651',
    '1652',
    '1653',
    '1658',
    '1659',
    '1660',
    '1661',
    '1662',
    '1663',
    '1664',
    '1665',
    '1901',
    '1902',
    '1903',
    '1904',
    '1905',
    '1906',
    '1907',
    '1908',
    '1909',
    '1910',
    '1911',
    '1912',
    '1913',
    '1914',
    '1915',
    '1916',
    '1917',
    '1918',
    '1919',
    '1920',
    '1921',
    '1922',
    '1923',
    '1924',
    '1925',
    '1926',
    '1931',
    '1932',
    '1933',
    '1934',
    '1949',
  ],

  // Entradas de outro estado
  ENTRADA_INTERESTADUAL: [
    '2000',
    '2101',
    '2102',
    '2111',
    '2113',
    '2116',
    '2117',
    '2118',
    '2120',
    '2121',
    '2122',
    '2124',
    '2125',
    '2126',
    '2151',
    '2152',
    '2153',
    '2154',
    '2201',
    '2202',
    '2203',
    '2204',
    '2205',
    '2206',
    '2207',
    '2208',
    '2209',
    '2251',
    '2252',
    '2253',
    '2254',
    '2255',
    '2256',
    '2257',
    '2301',
    '2302',
    '2303',
    '2304',
    '2305',
    '2306',
    '2351',
    '2352',
    '2353',
    '2354',
    '2355',
    '2356',
    '2401',
    '2403',
    '2406',
    '2407',
    '2408',
    '2409',
    '2410',
    '2411',
    '2414',
    '2415',
    '2501',
    '2503',
    '2504',
    '2505',
    '2506',
    '2551',
    '2552',
    '2553',
    '2554',
    '2555',
    '2556',
    '2557',
    '2603',
    '2651',
    '2652',
    '2653',
    '2658',
    '2659',
    '2660',
    '2661',
    '2662',
    '2663',
    '2664',
    '2665',
    '2901',
    '2902',
    '2903',
    '2904',
    '2905',
    '2906',
    '2907',
    '2908',
    '2909',
    '2910',
    '2911',
    '2912',
    '2913',
    '2914',
    '2915',
    '2916',
    '2917',
    '2918',
    '2919',
    '2920',
    '2921',
    '2922',
    '2923',
    '2924',
    '2925',
    '2931',
    '2932',
    '2933',
    '2934',
    '2949',
  ],

  // Entradas do exterior
  ENTRADA_EXTERIOR: [
    '3101',
    '3102',
    '3126',
    '3127',
    '3128',
    '3201',
    '3202',
    '3205',
    '3206',
    '3207',
    '3211',
    '3251',
    '3301',
    '3351',
    '3352',
    '3353',
    '3354',
    '3355',
    '3356',
    '3503',
    '3551',
    '3553',
    '3556',
    '3651',
    '3652',
    '3653',
    '3901',
    '3902',
    '3903',
    '3930',
    '3949',
  ],

  // Saídas dentro do estado
  SAIDA_ESTADO: [
    '5000',
    '5101',
    '5102',
    '5103',
    '5104',
    '5105',
    '5106',
    '5109',
    '5110',
    '5111',
    '5112',
    '5113',
    '5114',
    '5115',
    '5116',
    '5117',
    '5118',
    '5119',
    '5120',
    '5122',
    '5123',
    '5124',
    '5125',
    '5151',
    '5152',
    '5153',
    '5155',
    '5156',
    '5201',
    '5202',
    '5205',
    '5206',
    '5207',
    '5208',
    '5209',
    '5210',
    '5251',
    '5252',
    '5253',
    '5254',
    '5255',
    '5256',
    '5257',
    '5258',
    '5301',
    '5302',
    '5303',
    '5304',
    '5305',
    '5306',
    '5307',
    '5351',
    '5352',
    '5353',
    '5354',
    '5355',
    '5356',
    '5357',
    '5359',
    '5360',
    '5401',
    '5402',
    '5403',
    '5405',
    '5408',
    '5409',
    '5410',
    '5411',
    '5412',
    '5413',
    '5414',
    '5415',
    '5451',
    '5501',
    '5502',
    '5503',
    '5504',
    '5505',
    '5551',
    '5552',
    '5553',
    '5554',
    '5555',
    '5556',
    '5557',
    '5601',
    '5602',
    '5603',
    '5605',
    '5606',
    '5651',
    '5652',
    '5653',
    '5654',
    '5655',
    '5656',
    '5657',
    '5658',
    '5659',
    '5660',
    '5661',
    '5662',
    '5663',
    '5664',
    '5665',
    '5666',
    '5667',
    '5901',
    '5902',
    '5903',
    '5904',
    '5905',
    '5906',
    '5907',
    '5908',
    '5909',
    '5910',
    '5911',
    '5912',
    '5913',
    '5914',
    '5915',
    '5916',
    '5917',
    '5918',
    '5919',
    '5920',
    '5921',
    '5922',
    '5923',
    '5924',
    '5925',
    '5926',
    '5927',
    '5928',
    '5929',
    '5931',
    '5932',
    '5933',
    '5934',
    '5949',
  ],

  // Saídas para outro estado
  SAIDA_INTERESTADUAL: [
    '6000',
    '6101',
    '6102',
    '6103',
    '6104',
    '6105',
    '6106',
    '6107',
    '6108',
    '6109',
    '6110',
    '6111',
    '6112',
    '6113',
    '6114',
    '6115',
    '6116',
    '6117',
    '6118',
    '6119',
    '6120',
    '6122',
    '6123',
    '6124',
    '6125',
    '6151',
    '6152',
    '6153',
    '6155',
    '6156',
    '6201',
    '6202',
    '6205',
    '6206',
    '6207',
    '6208',
    '6209',
    '6210',
    '6251',
    '6252',
    '6253',
    '6254',
    '6255',
    '6256',
    '6257',
    '6258',
    '6301',
    '6302',
    '6303',
    '6304',
    '6305',
    '6306',
    '6307',
    '6351',
    '6352',
    '6353',
    '6354',
    '6355',
    '6356',
    '6357',
    '6359',
    '6360',
    '6401',
    '6402',
    '6403',
    '6404',
    '6408',
    '6409',
    '6410',
    '6411',
    '6412',
    '6413',
    '6414',
    '6415',
    '6501',
    '6502',
    '6503',
    '6504',
    '6505',
    '6551',
    '6552',
    '6553',
    '6554',
    '6555',
    '6556',
    '6557',
    '6603',
    '6651',
    '6652',
    '6653',
    '6654',
    '6655',
    '6656',
    '6657',
    '6658',
    '6659',
    '6660',
    '6661',
    '6662',
    '6663',
    '6664',
    '6665',
    '6666',
    '6667',
    '6901',
    '6902',
    '6903',
    '6904',
    '6905',
    '6906',
    '6907',
    '6908',
    '6909',
    '6910',
    '6911',
    '6912',
    '6913',
    '6914',
    '6915',
    '6916',
    '6917',
    '6918',
    '6919',
    '6920',
    '6921',
    '6922',
    '6923',
    '6924',
    '6925',
    '6929',
    '6931',
    '6932',
    '6933',
    '6934',
    '6949',
  ],

  // Saídas para o exterior
  SAIDA_EXTERIOR: [
    '7101',
    '7102',
    '7105',
    '7106',
    '7127',
    '7201',
    '7202',
    '7205',
    '7206',
    '7207',
    '7210',
    '7211',
    '7251',
    '7301',
    '7358',
    '7501',
    '7551',
    '7553',
    '7556',
    '7651',
    '7654',
    '7667',
    '7930',
    '7949',
  ],
} as const;

/**
 * Valida CFOP (Código Fiscal de Operações e Prestações)
 *
 * Regras:
 * - Deve ter exatamente 4 dígitos numéricos
 * - Primeiro dígito indica o tipo: 1-3 (entrada), 5-7 (saída)
 * - Deve estar na lista de CFOPs válidos
 *
 * @example validateCfop('5102') // { valid: true }
 * @example validateCfop('5999') // { valid: false, message: 'CFOP inválido' }
 */
export function validateCfop(cfop: string, strict = false): ValidationResult {
  if (!cfop) {
    return { valid: false, message: 'CFOP é obrigatório' };
  }

  // Remove caracteres não numéricos
  const cleanCfop = cfop.replace(/\D/g, '');

  if (cleanCfop.length !== 4) {
    return { valid: false, message: 'CFOP deve ter 4 dígitos' };
  }

  const firstDigit = cleanCfop[0];

  // Valida primeiro dígito (1-3 entrada, 5-7 saída)
  if (!['1', '2', '3', '5', '6', '7'].includes(firstDigit)) {
    return {
      valid: false,
      message:
        'CFOP inválido: primeiro dígito deve ser 1-3 (entrada) ou 5-7 (saída)',
    };
  }

  // Validação estrita: verifica se está na lista de CFOPs válidos
  if (strict) {
    const allCfops: string[] = Object.values(CFOP_GROUPS).flat();
    if (!allCfops.includes(cleanCfop)) {
      return {
        valid: false,
        message: `CFOP ${cleanCfop} não está na lista de CFOPs válidos`,
      };
    }
  }

  return { valid: true };
}

/**
 * Formata CFOP para o padrão sem pontuação (4 dígitos)
 */
export function formatCfop(cfop: string): string {
  return (cfop || '').replace(/\D/g, '').padStart(4, '0').substring(0, 4);
}

/**
 * Determina o CFOP correto baseado na UF do emitente e destinatário
 */
export function getCfopByUf(
  cfopBase: string,
  emitUf: string,
  destUf: string,
): string {
  const cleanCfop = formatCfop(cfopBase);
  const firstDigit = cleanCfop[0];
  const restCfop = cleanCfop.substring(1);

  // Saída
  if (['5', '6', '7'].includes(firstDigit)) {
    if (destUf === 'EX') return `7${restCfop}`; // Exterior
    if (emitUf === destUf) return `5${restCfop}`; // Mesmo estado
    return `6${restCfop}`; // Interestadual
  }

  // Entrada
  if (['1', '2', '3'].includes(firstDigit)) {
    if (emitUf === 'EX') return `3${restCfop}`; // Exterior
    if (emitUf === destUf) return `1${restCfop}`; // Mesmo estado
    return `2${restCfop}`; // Interestadual
  }

  return cleanCfop;
}

// ==================== CST ====================

/**
 * CSTs válidos para ICMS
 */
export const CST_ICMS = {
  '00': 'Tributada integralmente',
  '10': 'Tributada e com cobrança de ICMS por ST',
  '20': 'Com redução de base de cálculo',
  '30': 'Isenta ou não tributada e com cobrança de ICMS por ST',
  '40': 'Isenta',
  '41': 'Não tributada',
  '50': 'Suspensão',
  '51': 'Diferimento',
  '60': 'ICMS cobrado anteriormente por ST',
  '70': 'Com redução de base de cálculo e cobrança de ICMS por ST',
  '90': 'Outras',
} as const;

/**
 * CSOSNs válidos para Simples Nacional
 */
export const CSOSN = {
  '101': 'Tributada pelo Simples Nacional com permissão de crédito',
  '102': 'Tributada pelo Simples Nacional sem permissão de crédito',
  '103': 'Isenção do ICMS no Simples Nacional para faixa de receita bruta',
  '201':
    'Tributada pelo Simples Nacional com permissão de crédito e com cobrança de ICMS por ST',
  '202':
    'Tributada pelo Simples Nacional sem permissão de crédito e com cobrança de ICMS por ST',
  '203': 'Isenção do ICMS por faixa e com cobrança de ICMS por ST',
  '300': 'Imune',
  '400': 'Não tributada pelo Simples Nacional',
  '500': 'ICMS cobrado anteriormente por ST ou por antecipação',
  '900': 'Outros',
} as const;

/**
 * Valida CST ICMS
 */
export function validateCstIcms(cst: string): ValidationResult {
  if (!cst) {
    return { valid: false, message: 'CST ICMS é obrigatório' };
  }

  const cleanCst = cst.replace(/\D/g, '').padStart(2, '0');

  if (!(cleanCst in CST_ICMS)) {
    return { valid: false, message: `CST ICMS ${cst} não é válido` };
  }

  return { valid: true };
}

/**
 * Valida CSOSN (Simples Nacional)
 */
export function validateCsosn(csosn: string): ValidationResult {
  if (!csosn) {
    return { valid: false, message: 'CSOSN é obrigatório' };
  }

  const cleanCsosn = csosn.replace(/\D/g, '');

  if (!(cleanCsosn in CSOSN)) {
    return { valid: false, message: `CSOSN ${csosn} não é válido` };
  }

  return { valid: true };
}

// ==================== UF ====================

/**
 * Códigos IBGE de UFs
 */
export const UF_CODES: Record<string, number> = {
  AC: 12,
  AL: 27,
  AP: 16,
  AM: 13,
  BA: 29,
  CE: 23,
  DF: 53,
  ES: 32,
  GO: 52,
  MA: 21,
  MT: 51,
  MS: 50,
  MG: 31,
  PA: 15,
  PB: 25,
  PR: 41,
  PE: 26,
  PI: 22,
  RJ: 33,
  RN: 24,
  RS: 43,
  RO: 11,
  RR: 14,
  SC: 42,
  SP: 35,
  SE: 28,
  TO: 17,
  EX: 99,
};

/**
 * Valida UF
 */
export function validateUf(uf: string): ValidationResult {
  if (!uf) {
    return { valid: false, message: 'UF é obrigatória' };
  }

  const upperUf = uf.toUpperCase();

  if (!(upperUf in UF_CODES)) {
    return { valid: false, message: `UF ${uf} não é válida` };
  }

  return { valid: true };
}

/**
 * Obtém código IBGE da UF
 */
export function getUfCode(uf: string): number {
  return UF_CODES[uf?.toUpperCase()] || 0;
}

// ==================== Validação completa de item fiscal ====================

export interface FiscalItemValidation {
  ncm?: string;
  cfop?: string;
  cst?: string;
  csosn?: string;
  origem?: string;
  uf?: string;
}

/**
 * Valida todos os campos fiscais de um item
 */
export function validateFiscalItem(
  item: FiscalItemValidation,
  isSimples: boolean = false,
): ValidationResult[] {
  const results: ValidationResult[] = [];

  if (item.ncm) {
    const ncmResult = validateNcm(item.ncm);
    if (!ncmResult.valid)
      results.push({ ...ncmResult, message: `NCM: ${ncmResult.message}` });
  }

  if (item.cfop) {
    const cfopResult = validateCfop(item.cfop);
    if (!cfopResult.valid)
      results.push({ ...cfopResult, message: `CFOP: ${cfopResult.message}` });
  }

  if (isSimples && item.csosn) {
    const csosnResult = validateCsosn(item.csosn);
    if (!csosnResult.valid)
      results.push({
        ...csosnResult,
        message: `CSOSN: ${csosnResult.message}`,
      });
  } else if (!isSimples && item.cst) {
    const cstResult = validateCstIcms(item.cst);
    if (!cstResult.valid)
      results.push({ ...cstResult, message: `CST: ${cstResult.message}` });
  }

  if (item.uf) {
    const ufResult = validateUf(item.uf);
    if (!ufResult.valid)
      results.push({ ...ufResult, message: `UF: ${ufResult.message}` });
  }

  return results;
}

// ==================== CEP ====================

export function validateCep(cep: string): ValidationResult {
  if (!cep) {
    return { valid: false, message: 'CEP é obrigatório' };
  }
  const cleanCep = cep.replace(/\D/g, '');
  if (cleanCep.length !== 8) {
    return { valid: false, message: 'CEP deve ter 8 dígitos numéricos' };
  }
  return { valid: true };
}

// ==================== CPF e CNPJ ====================

export function validateCpf(cpf: string): ValidationResult {
  if (!cpf) return { valid: false, message: 'CPF é obrigatório' };
  const cleanCpf = cpf.replace(/\D/g, '');
  if (cleanCpf.length !== 11)
    return { valid: false, message: 'CPF deve ter 11 dígitos numéricos' };
  if (/^(\d)\1+$/.test(cleanCpf))
    return { valid: false, message: 'CPF inválido (dígitos repetidos)' };

  let sum = 0;
  for (let i = 1; i <= 9; i++)
    sum += parseInt(cleanCpf.substring(i - 1, i)) * (11 - i);
  let rest = (sum * 10) % 11;
  if (rest === 10 || rest === 11) rest = 0;
  if (rest !== parseInt(cleanCpf.substring(9, 10)))
    return { valid: false, message: 'CPF inválido (1º dígito)' };

  sum = 0;
  for (let i = 1; i <= 10; i++)
    sum += parseInt(cleanCpf.substring(i - 1, i)) * (12 - i);
  rest = (sum * 10) % 11;
  if (rest === 10 || rest === 11) rest = 0;
  if (rest !== parseInt(cleanCpf.substring(10, 11)))
    return { valid: false, message: 'CPF inválido (2º dígito)' };

  return { valid: true };
}

export function validateCnpj(cnpj: string): ValidationResult {
  if (!cnpj) return { valid: false, message: 'CNPJ é obrigatório' };
  const cleanCnpj = cnpj.replace(/\D/g, '');
  if (cleanCnpj.length !== 14)
    return { valid: false, message: 'CNPJ deve ter 14 dígitos numéricos' };
  if (/^(\d)\1+$/.test(cleanCnpj))
    return { valid: false, message: 'CNPJ inválido (dígitos repetidos)' };

  let size = cleanCnpj.length - 2;
  let numbers = cleanCnpj.substring(0, size);
  const digits = cleanCnpj.substring(size);
  let sum = 0;
  let pos = size - 7;
  for (let i = size; i >= 1; i--) {
    sum += parseInt(numbers.charAt(size - i)) * pos--;
    if (pos < 2) pos = 9;
  }
  let result = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  if (result !== parseInt(digits.charAt(0)))
    return { valid: false, message: 'CNPJ inválido (1º dígito)' };

  size += 1;
  numbers = cleanCnpj.substring(0, size);
  sum = 0;
  pos = size - 7;
  for (let i = size; i >= 1; i--) {
    sum += parseInt(numbers.charAt(size - i)) * pos--;
    if (pos < 2) pos = 9;
  }
  result = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  if (result !== parseInt(digits.charAt(1)))
    return { valid: false, message: 'CNPJ inválido (2º dígito)' };

  return { valid: true };
}
