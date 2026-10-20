import { BadRequestException } from '@nestjs/common';
import { Prisma, SheetFormat } from '@prisma/client';

/**
 * Papéis no LITE (decisão do PO de 13/10/2026): o papel é um material com a
 * forma "folha" (shape SHEET), com gramatura, formato da folha e área útil,
 * sem custo nem preço. O PRO abre a tela completa de Materiais sobre os
 * mesmos registros. Medidas em milímetros.
 */

/** As folhas padrão, em pé (largura × altura), em mm. */
export const SHEET_FORMAT_SIZES: Record<
  Exclude<SheetFormat, 'CUSTOM'>,
  { width: number; height: number }
> = {
  A4: { width: 210, height: 297 },
  A3: { width: 297, height: 420 },
  SRA3: { width: 320, height: 450 },
  A3_PLUS: { width: 329, height: 483 },
};

/** O formato como a tela escreve. */
export const SHEET_FORMAT_LABELS: Record<SheetFormat, string> = {
  A4: 'A4',
  A3: 'A3',
  SRA3: 'SRA3',
  A3_PLUS: 'A3+',
  CUSTOM: 'Personalizado',
};

/** A medida da folha padrão; nula no personalizado e sem formato. */
export const sheetSizeOf = (format: SheetFormat | null | undefined) =>
  format && format !== 'CUSTOM' ? SHEET_FORMAT_SIZES[format] : null;

/** O papel como a variação do produto e o item leem: sem custo nem preço. */
export const PAPER_SELECT = {
  id: true,
  name: true,
  grammage: true,
  sheetFormat: true,
  sheetWidth: true,
  sheetHeight: true,
  usableWidth: true,
  usableHeight: true,
} satisfies Prisma.MaterialSelect;

export type PaperRow = Prisma.MaterialGetPayload<{
  select: typeof PAPER_SELECT;
}>;

/** Os campos do papel no cadastro, na ordem da tela. */
export const PAPER_FIELDS = [
  'grammage',
  'sheetFormat',
  'sheetWidth',
  'sheetHeight',
  'usableWidth',
  'usableHeight',
] as const;

export type PaperField = (typeof PAPER_FIELDS)[number];

/** As colunas do papel no material. */
export type PaperColumns = {
  grammage: number | null;
  sheetFormat: SheetFormat | null;
  sheetWidth: number | null;
  sheetHeight: number | null;
  usableWidth: number | null;
  usableHeight: number | null;
};

/** O que veio no corpo: `undefined` não mexe, `null` limpa. */
export type PaperInput = Partial<PaperColumns>;

export const NO_PAPER: PaperColumns = {
  grammage: null,
  sheetFormat: null,
  sheetWidth: null,
  sheetHeight: null,
  usableWidth: null,
  usableHeight: null,
};

export const NOT_A_PAPER = 'Este material não é um papel';
export const PAPER_FIELDS_NEED_SHEET =
  'Gramatura, formato da folha e área útil são do papel: escolha a forma folha (SHEET) na configuração avançada';

/** As colunas do papel de um registro (o que falta vale nulo). */
export const paperColumnsOf = (
  row: Partial<Record<PaperField, unknown>>,
): PaperColumns => ({
  grammage: (row.grammage as number) ?? null,
  sheetFormat: (row.sheetFormat as SheetFormat) ?? null,
  sheetWidth: (row.sheetWidth as number) ?? null,
  sheetHeight: (row.sheetHeight as number) ?? null,
  usableWidth: (row.usableWidth as number) ?? null,
  usableHeight: (row.usableHeight as number) ?? null,
});

/** Só os campos do papel que vieram no corpo. */
export const paperInputOf = (
  body: Partial<Record<PaperField, unknown>>,
): PaperInput => {
  const input: PaperInput = {};
  for (const field of PAPER_FIELDS) {
    if (body[field] !== undefined) (input as any)[field] = body[field];
  }
  return input;
};

/** Algum campo do papel veio com valor (nulo é limpar, não conta). */
export const hasPaperValues = (input: PaperInput) =>
  PAPER_FIELDS.some(
    (field) => input[field] !== undefined && input[field] !== null,
  );

const positive = (value: number | null | undefined) =>
  typeof value === 'number' && value > 0;

/** A peça (ou a área) cabe no retângulo, em pé ou deitada. */
export const fitsIn = (
  inner: { width: number; height: number },
  outer: { width: number; height: number },
) =>
  (inner.width <= outer.width && inner.height <= outer.height) ||
  (inner.width <= outer.height && inner.height <= outer.width);

const mm = (value: number) =>
  value.toLocaleString('pt-BR', { maximumFractionDigits: 1 });

/**
 * O papel depois da escrita: junta o que está gravado com o que veio e
 * confere. O formato padrão preenche a folha (a medida que vier tem de ser a
 * dele, em pé ou deitada); o personalizado exige largura e altura; a área
 * útil vem inteira (as duas medidas ou nenhuma) e cabe na folha. Área útil
 * vazia = a folha inteira.
 */
export function resolvePaper(
  current: PaperColumns,
  input: PaperInput,
  options: { requireFormat?: boolean } = {},
): PaperColumns {
  const paper: PaperColumns = { ...current };
  for (const field of PAPER_FIELDS) {
    if (input[field] !== undefined) (paper as any)[field] = input[field];
  }

  if (!paper.sheetFormat && options.requireFormat) {
    throw new BadRequestException('Informe o formato da folha');
  }

  const size = sheetSizeOf(paper.sheetFormat);
  if (size) {
    const given = positive(paper.sheetWidth) && positive(paper.sheetHeight);
    const matches =
      given &&
      fitsIn({ width: paper.sheetWidth!, height: paper.sheetHeight! }, size) &&
      fitsIn(size, { width: paper.sheetWidth!, height: paper.sheetHeight! });
    const sentNow =
      positive(input.sheetWidth ?? null) || positive(input.sheetHeight ?? null);
    if (!matches) {
      if (sentNow) {
        const label = SHEET_FORMAT_LABELS[paper.sheetFormat!];
        throw new BadRequestException(
          `A folha ${label} tem ${mm(size.width)} × ${mm(size.height)} mm: para outra medida, use o formato personalizado`,
        );
      }
      paper.sheetWidth = size.width;
      paper.sheetHeight = size.height;
    }
  } else if (paper.sheetFormat === 'CUSTOM') {
    if (!positive(paper.sheetWidth) || !positive(paper.sheetHeight)) {
      throw new BadRequestException(
        'No formato personalizado, informe a largura e a altura da folha',
      );
    }
  }

  const usableWidth = paper.usableWidth;
  const usableHeight = paper.usableHeight;
  if ((usableWidth === null) !== (usableHeight === null)) {
    throw new BadRequestException(
      'Informe a largura e a altura da área útil, ou deixe as duas vazias',
    );
  }
  if (usableWidth !== null && usableHeight !== null) {
    if (!positive(usableWidth) || !positive(usableHeight)) {
      throw new BadRequestException('A área útil vai em mm, maior que zero');
    }
    if (!positive(paper.sheetWidth) || !positive(paper.sheetHeight)) {
      throw new BadRequestException('Informe a folha antes da área útil');
    }
    if (
      !fitsIn(
        { width: usableWidth, height: usableHeight },
        { width: paper.sheetWidth!, height: paper.sheetHeight! },
      )
    ) {
      throw new BadRequestException(
        'A área útil não pode ser maior que a folha',
      );
    }
  }
  return paper;
}

/** Só as colunas que mudam (nulo e ausente são o mesmo). */
export const changedPaperColumns = (
  before: PaperColumns,
  after: PaperColumns,
): Partial<PaperColumns> => {
  const changed: Partial<PaperColumns> = {};
  for (const field of PAPER_FIELDS) {
    if ((before[field] ?? null) !== (after[field] ?? null)) {
      (changed as any)[field] = after[field];
    }
  }
  return changed;
};
