/**
 * Lê do XML da NF-e o que a entrada de nota precisa (ES-1): a chave, o
 * número, a emissão, o emitente, o total e os itens do fornecedor. O XML
 * da NF-e é plano o bastante para ser lido por etiqueta, sem um leitor de
 * XML inteiro. Valores em centavos.
 */

export type NfeItem = {
  position: number;
  supplierCode: string;
  description: string;
  supplierUnit: string;
  quantity: number;
  /** Centavos por unidade do fornecedor */
  unitValue: number;
  gtin: string | null;
};

export type NfeInvoice = {
  accessKey: string | null;
  number: string;
  series: string | null;
  issueDate: Date;
  supplierName: string;
  supplierDocument: string | null;
  total: number;
  items: NfeItem[];
};

export class NfeXmlError extends Error {}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

const decode = (text: string) =>
  text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCharCode(parseInt(code, 16)),
    )
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => ENTITIES[name])
    .trim();

/** O conteúdo da primeira etiqueta, com ou sem prefixo de namespace. */
const tag = (xml: string, name: string): string | null => {
  const match = new RegExp(
    `<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`,
  ).exec(xml);
  return match ? decode(match[1]) : null;
};

const block = (xml: string, name: string): string | null => {
  const match = new RegExp(
    `<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`,
  ).exec(xml);
  return match ? match[1] : null;
};

const cents = (value: string | null) =>
  value === null ? 0 : Math.round(Number(value.replace(',', '.')) * 100);

export function parseNfeXml(xml: string): NfeInvoice {
  const infNFe = /<(?:\w+:)?infNFe\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?infNFe>/.exec(
    xml ?? '',
  );
  if (!infNFe) throw new NfeXmlError('O arquivo não é o XML de uma NF-e');
  const body = infNFe[2];
  const id = /\bId="(?:NFe)?(\d{44})"/.exec(infNFe[1]);
  const ide = block(body, 'ide') ?? '';
  const emit = block(body, 'emit') ?? '';
  const number = tag(ide, 'nNF');
  const issued = tag(ide, 'dhEmi') ?? tag(ide, 'dEmi');
  if (!number || !issued) {
    throw new NfeXmlError('O XML da NF-e não tem o número ou a emissão');
  }
  const items: NfeItem[] = [];
  const det =
    /<(?:\w+:)?det\b[^>]*?nItem="(\d+)"[^>]*>([\s\S]*?)<\/(?:\w+:)?det>/g;
  for (let match = det.exec(body); match; match = det.exec(body)) {
    const prod = block(match[2], 'prod') ?? '';
    const gtin = tag(prod, 'cEAN');
    items.push({
      position: Number(match[1]),
      supplierCode: tag(prod, 'cProd') ?? '',
      description: tag(prod, 'xProd') ?? '',
      supplierUnit: (tag(prod, 'uCom') ?? '').toUpperCase(),
      quantity: Number((tag(prod, 'qCom') ?? '0').replace(',', '.')),
      unitValue: cents(tag(prod, 'vUnCom')),
      gtin: gtin && /^\d{8,14}$/.test(gtin) ? gtin : null,
    });
  }
  if (!items.length) throw new NfeXmlError('A NF-e não tem itens');
  const document = tag(emit, 'CNPJ') ?? tag(emit, 'CPF');
  return {
    accessKey: id ? id[1] : null,
    number,
    series: tag(ide, 'serie'),
    issueDate: new Date(issued.length === 10 ? `${issued}T12:00:00` : issued),
    supplierName: tag(emit, 'xNome') ?? tag(emit, 'xFant') ?? 'Fornecedor',
    supplierDocument: document ? document.replace(/\D/g, '') : null,
    total: cents(tag(block(body, 'ICMSTot') ?? body, 'vNF')),
    items,
  };
}
