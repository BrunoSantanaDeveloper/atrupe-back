import { defaultsCadastroFiscal } from './product-fiscal-defaults.util';

/** Os campos fiscais que o material de venda direta guarda (`Material.fiscal`). */
export const MATERIAL_FISCAL_FIELDS = [
  'ncm',
  'cest',
  'cean',
  'commercialUnit',
  'icmsOrigin',
  'icmsCst',
  'pisCst',
  'cofinsCst',
  'ipiCst',
  'cfopInState',
  'cfopOutState',
] as const;

export type MaterialFiscalField = (typeof MATERIAL_FISCAL_FIELDS)[number];
export type MaterialFiscal = Partial<Record<MaterialFiscalField, string>>;

/** Só os campos conhecidos, com texto: o resto do JSON é ignorado. */
export function pickMaterialFiscal(value: unknown): MaterialFiscal {
  if (!value || typeof value !== 'object') return {};
  const picked: MaterialFiscal = {};
  for (const key of MATERIAL_FISCAL_FIELDS) {
    const raw = (value as Record<string, unknown>)[key];
    if (typeof raw === 'string' && raw.trim()) picked[key] = raw.trim();
  }
  return picked;
}

/**
 * O cadastro fiscal do item sem produto (decisões do PO de 14/10/2026):
 * - o item montado na hora usa o padrão genérico do emissor, o mesmo que o
 *   produto sem cadastro fiscal recebe (`getOrCreateWithDefaults`);
 * - o material de venda direta usa o que o cadastro dele tiver por cima
 *   desse padrão.
 *
 * Devolve os campos com os mesmos nomes do `ProductFiscalData`: quem monta a
 * nota lê os dois do mesmo jeito.
 */
export function itemFiscalData(
  config: {
    defaultNcm?: string | null;
    defaultCfop?: string | null;
    emitCrt?: number | null;
  } | null,
  materialFiscal?: unknown,
) {
  return {
    ncm: config?.defaultNcm || '49119900',
    cfopInState: config?.defaultCfop || '5101',
    ...defaultsCadastroFiscal(config?.emitCrt),
    cest: null as string | null,
    cean: null as string | null,
    ipiCst: null as string | null,
    ...pickMaterialFiscal(materialFiscal),
  };
}
