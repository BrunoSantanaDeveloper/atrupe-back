import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AssemblyResource, toEngineOption } from './assembly-resource.service';
import {
  CreateLineDto,
  CreateOptionDto,
  UpdateLineDto,
} from './dto/composition.dto';
import { MEASURE_NAMES, normalizeName } from './engine/formula';
import { EngineLine, FormulaKey } from './engine/types';

/*
 * As linhas, as opções, os campos e as fórmulas têm o mesmo contrato no
 * processo e na etapa do produto (MS-11): as regras ficam aqui, e cada
 * serviço grava no dono dele.
 */

export const LINE_NOT_FOUND = 'Linha não encontrada';
export const OPTION_NOT_FOUND = 'Opção não encontrada';
export const FIELD_NOT_FOUND = 'Campo não encontrado';
export const FORMULA_NOT_FOUND = 'Fórmula não encontrada';
/** AB-19: no setor que vende pelo equipamento, o impressor já está no m² */
export const EQUIPMENT_SECTOR_LABOR =
  'Este setor vende pelo equipamento: a mão de obra já está no preço dele';

export const LINE_INCLUDE = {
  options: { orderBy: [{ position: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.AssemblyLineInclude;

export type LineRow = Prisma.AssemblyLineGetPayload<{
  include: typeof LINE_INCLUDE;
}>;

/** O que a linha precisa conferir fora dela. */
export type LineContext = {
  /** Os recursos citados, resolvidos do cadastro */
  resources: Map<string, AssemblyResource>;
  /** Como vende o setor da etapa (AB-19) */
  sectorSaleUnit: string;
  /** As fórmulas do dono (processo ou composição) */
  formulaIds: Set<string>;
};

const bad = (message: string): never => {
  throw new BadRequestException(message);
};

const peopleOf = (kind: string, people: number | null | undefined) =>
  kind === 'LABOR' ? Math.max(1, Math.round(people || 1)) : null;

/** Os ids de recurso que a linha usa, para resolver de uma vez. */
export const resourceIdsOf = (lines: Pick<LineRow, 'options'>[]) => [
  ...new Set(lines.flatMap((line) => line.options.map((o) => o.resourceId))),
];

/**
 * A linha nova (IP-31), pronta para gravar com o dono. Em LIST nasce sem
 * escolhida, com o vendedor informando, sem perda e sem mínimo (IP-8); nos
 * outros modos, a primeira opção é a escolhida.
 */
export const newLineData = (dto: CreateLineDto, ctx: LineContext) => {
  const name = dto.name.trim();
  if (!name) bad('Informe o nome da linha');
  const formula: FormulaKey = dto.formula ?? 'FIXED';
  if (
    formula === 'CUSTOM' &&
    !(dto.formulaId && ctx.formulaIds.has(dto.formulaId))
  ) {
    bad('Escolha a fórmula do produto');
  }

  if (!dto.resourceIds.length) bad('Escolha ao menos um recurso');
  if (new Set(dto.resourceIds).size !== dto.resourceIds.length) {
    bad('Este recurso já está na linha: dê um nome à configuração');
  }
  const resources = dto.resourceIds.map((id) => ctx.resources.get(id));
  if (resources.some((resource) => !resource)) bad('Recurso não encontrado');
  const found = resources as AssemblyResource[];
  if (found.some((resource) => resource.kind !== dto.kind)) {
    bad('Este recurso não é do tipo da linha');
  }
  if (dto.kind === 'LABOR' && ctx.sectorSaleUnit !== 'HOUR') {
    bad(EQUIPMENT_SECTOR_LABOR);
  }
  if (dto.mode === 'SINGLE' && found.length > 1) {
    bad('Recurso único leva um recurso só');
  }
  // As opções de uma escolha são trocadas entre si: precisam medir igual (IP-39)
  if (
    dto.mode === 'CHOOSE' &&
    new Set(found.map((resource) => resource.unit)).size > 1
  ) {
    bad('As opções de uma escolha precisam ter a mesma unidade');
  }

  const list = dto.mode === 'LIST';
  const options = found.map((resource, position) => ({
    id: randomUUID(),
    resourceId: resource.resourceId,
    position,
  }));
  const optional = dto.optional ?? false;
  return {
    line: {
      id: randomUUID(),
      name,
      kind: dto.kind,
      mode: dto.mode,
      formula: list ? 'SELLER' : formula,
      perUnit: list ? 0 : (dto.perUnit ?? 1),
      lossPercent: list ? 0 : (dto.lossPercent ?? 0),
      minimum: list ? null : (dto.minimum ?? null),
      optional,
      optionalDefault: optional ? (dto.optionalDefault ?? true) : true,
      fieldName: dto.fieldName?.trim() || null,
      formulaId: !list && formula === 'CUSTOM' ? dto.formulaId! : null,
      people: peopleOf(dto.kind, dto.people),
      selectedOptionId: list ? null : options[0].id,
    },
    options,
  };
};

/**
 * O ajuste da linha (IP-22, IP-26). `onlyChoice` diz se só a opção escolhida
 * mudou: na etapa de processo isso é uso normal, não ajuste (CP-21).
 */
export const lineUpdateData = (
  row: LineRow,
  dto: UpdateLineDto,
  ctx: Pick<LineContext, 'formulaIds'>,
) => {
  const given = Object.entries(dto).filter(([, value]) => value !== undefined);
  const onlyChoice = given.every(([key]) => key === 'selectedId');
  const data: Prisma.AssemblyLineUncheckedUpdateInput = {};

  if (dto.name !== undefined) {
    const name = dto.name.trim();
    if (!name) bad('Informe o nome da linha');
    data.name = name;
  }
  if (dto.selectedId !== undefined) {
    if (dto.selectedId === '' && row.mode === 'LIST') {
      data.selectedOptionId = null;
    } else if (!row.options.some((option) => option.id === dto.selectedId)) {
      bad('Escolha uma opção desta linha');
    } else {
      data.selectedOptionId = dto.selectedId;
    }
  }
  for (const key of [
    'perUnit',
    'lossPercent',
    'minimum',
    'optional',
    'optionalDefault',
    'sheetMargin',
    'sheetGap',
    'chargeWholeSheets',
  ] as const) {
    if (dto[key] !== undefined) data[key] = dto[key];
  }
  if (dto.fieldName !== undefined)
    data.fieldName = dto.fieldName?.trim() || null;

  const formula = dto.formula ?? (row.formula as FormulaKey);
  if (dto.formula !== undefined) data.formula = dto.formula;
  if (formula === 'CUSTOM') {
    const formulaId =
      dto.formulaId !== undefined ? dto.formulaId : row.formulaId;
    if (!formulaId || !ctx.formulaIds.has(formulaId)) {
      bad('Escolha a fórmula do produto');
    }
    data.formulaId = formulaId;
  } else {
    data.formulaId = null;
  }
  if (dto.people !== undefined) data.people = peopleOf(row.kind, dto.people);

  // Consumo, perda e mínimo por opção: nulo volta ao valor da linha (IP-26)
  const optionUpdates = (dto.optionValues || [])
    .filter((value) => row.options.some((option) => option.id === value.id))
    .map((value) => ({
      id: value.id,
      data: {
        perUnit: value.perUnit ?? null,
        lossPercent: value.lossPercent ?? null,
        minimum: value.minimum ?? null,
      },
    }));

  return { data, optionUpdates, onlyChoice };
};

/**
 * A opção nova de uma escolha ou lista (IP-27, IP-31). O mesmo recurso pode
 * entrar de novo com outra configuração.
 */
export const newOptionData = (
  row: LineRow,
  dto: CreateOptionDto,
  ctx: Pick<LineContext, 'resources' | 'sectorSaleUnit'>,
) => {
  if (row.mode === 'SINGLE') bad('Recurso único não tem opções');
  const resource = ctx.resources.get(dto.resourceId);
  if (!resource) return bad('Recurso não encontrado');
  if (resource.kind !== row.kind) bad('Este recurso não é do tipo da linha');
  if (row.kind === 'LABOR' && ctx.sectorSaleUnit !== 'HOUR') {
    bad(EQUIPMENT_SECTOR_LABOR);
  }
  const first = row.options[0] && ctx.resources.get(row.options[0].resourceId);
  if (row.mode === 'CHOOSE' && first && first.unit !== resource.unit) {
    bad(`As opções desta linha são em ${first.unit}`);
  }

  const configName = dto.configName?.trim() || '';
  const sameResource = row.options.filter(
    (option) => option.resourceId === dto.resourceId,
  );
  // O mesmo recurso duas vezes só com nome de configuração para diferenciar
  if (sameResource.length && !configName) {
    bad('Este recurso já está na linha: dê um nome à configuração');
  }
  if (
    configName &&
    sameResource.some(
      (option) =>
        normalizeName(option.configName || '') === normalizeName(configName),
    )
  ) {
    bad('Já existe uma configuração com esse nome');
  }

  const option = {
    id: randomUUID(),
    resourceId: resource.resourceId,
    configName: configName || null,
    perUnit: dto.perUnit ?? null,
    position: row.options.reduce(
      (max, item) => Math.max(max, item.position + 1),
      0,
    ),
  };
  // A escolha sem escolhida passa a escolher esta
  const select = row.mode === 'CHOOSE' && !row.selectedOptionId;
  return { option, selectedOptionId: select ? option.id : undefined };
};

/** Tirar uma opção: a linha não fica sem recurso (IP-37). */
export const removeOptionData = (row: LineRow, optionId: string) => {
  if (!row.options.some((option) => option.id === optionId)) {
    throw new NotFoundException(OPTION_NOT_FOUND);
  }
  if (row.options.length <= 1) {
    bad('A linha precisa de ao menos um recurso; remova a linha');
  }
  const rest = row.options.filter((option) => option.id !== optionId);
  return {
    selectedOptionId:
      row.selectedOptionId === optionId ? rest[0].id : undefined,
  };
};

/* --------------------------------------------------------------------------
 * Campos do orçamento (IP-4, IP-19) e fórmulas (IP-2)
 * ------------------------------------------------------------------------ */

type NamedRow = { id: string; name: string };

/** O campo com esse nome, sem acento e sem maiúscula. */
export const findByName = <T extends NamedRow>(rows: T[], name: string) =>
  rows.find((row) => normalizeName(row.name) === normalizeName(name));

/**
 * O campo não pode ter o nome de uma medida do sistema (largura, perímetro…):
 * a fórmula e o tipo de cálculo leriam a medida, não o campo (20/11/2026; o
 * "perimetro" passava porque só se comparava com os campos do produto).
 */
export const systemNameCheck = (name: string, current?: string) => {
  // O campo antigo que já tinha esse nome continua editável
  if (current !== undefined && normalizeName(current) === normalizeName(name)) {
    return;
  }
  const system = MEASURE_NAMES.find(
    (item) => normalizeName(item) === normalizeName(name),
  );
  if (system) {
    bad(
      `"${system[0].toUpperCase()}${system.slice(1)}" já é uma medida do sistema. Use outro nome, como "${name.trim()} linear"`,
    );
  }
};

/** Campo inteiro recusa decimal (IP-19): no padrão, na venda e na simulação. */
export const integerCheck = (
  field: { name: string; allowsFraction: boolean },
  value: number,
) => {
  if (!field.allowsFraction && !Number.isInteger(value)) {
    bad(
      `${field.name} é um número inteiro. Ligue "Aceita fração" se o campo puder ter decimais`,
    );
  }
};

export const FIELD_IN_USE = (stages: string[]) =>
  `Este campo é lido em ${stages.join(', ')}. Troque o campo nessas linhas antes de removê-lo`;

export const FORMULA_IN_USE = (stages: string[]) =>
  `Esta fórmula é usada em ${stages.join(', ')}. Troque o tipo de cálculo nessas linhas antes de removê-la`;

/* --------------------------------------------------------------------------
 * Para o motor
 * ------------------------------------------------------------------------ */

/**
 * A linha gravada como o motor lê. A opção cujo recurso saiu do cadastro
 * (material inativo) fica de fora: a linha pode ficar sem recurso, e a tela
 * mostra o aviso (IP-37).
 */
export const toEngineLine = (
  row: LineRow,
  resources: Map<string, AssemblyResource>,
): EngineLine => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  mode: row.mode,
  options: row.options.flatMap((option) => {
    const resource = resources.get(option.resourceId);
    return resource ? [toEngineOption(resource, option)] : [];
  }),
  selectedId: row.selectedOptionId ?? '',
  perUnit: row.perUnit,
  formula: row.formula as FormulaKey,
  lossPercent: row.lossPercent,
  minimum: row.minimum,
  overridden: row.overridden,
  ...(row.sourceLineId ? { sourceLineId: row.sourceLineId } : {}),
  ...(row.addedHere ? { addedHere: true } : {}),
  optional: row.optional,
  ...(row.optional ? { optionalDefault: row.optionalDefault } : {}),
  ...(row.fieldName ? { fieldName: row.fieldName } : {}),
  ...(row.formulaId ? { formulaId: row.formulaId } : {}),
  ...(row.people != null ? { people: row.people } : {}),
  ...(row.sheetMargin != null ? { sheetMargin: row.sheetMargin } : {}),
  ...(row.sheetGap != null ? { sheetGap: row.sheetGap } : {}),
  ...(row.chargeWholeSheets != null
    ? { chargeWholeSheets: row.chargeWholeSheets }
    : {}),
});
