import { Prisma } from '@prisma/client';
import {
  KEPT_MODELS,
  RESET_STEPS,
  ResetOptions,
  stepsFor,
} from './account-reset.plan';

/**
 * O plano é conferido contra o schema: se alguém criar uma tabela ligada à
 * empresa, a um orçamento, a um cliente ou a um produto, o teste aponta antes
 * de o "zerar" falhar em produção — ou de deixar dado para trás.
 */
const models = Prisma.dmmf.datamodel.models;
const modelOf = (name: string) => {
  const model = models.find((m) => m.name === name);
  if (!model) throw new Error(`Modelo ${name} não existe no schema`);
  return model;
};

const ALL_OPTIONS: ResetOptions[] = [
  { includeFiscalDocuments: false, restoreDefaults: false },
  { includeFiscalDocuments: true, restoreDefaults: false },
  { includeFiscalDocuments: false, restoreDefaults: true },
  { includeFiscalDocuments: true, restoreDefaults: true },
];

/** Os campos do filtro existem no modelo — e, nas relações, no modelo de lá. */
function checkWhere(modelName: string, where: Record<string, any>) {
  const model = modelOf(modelName);
  for (const [key, value] of Object.entries(where)) {
    if (key === 'OR' || key === 'AND') {
      for (const part of value as Record<string, any>[]) {
        checkWhere(modelName, part);
      }
      continue;
    }
    const field = model.fields.find((f) => f.name === key);
    if (!field) throw new Error(`${modelName} não tem o campo ${key}`);
    if (field.kind === 'object') checkWhere(field.type, value);
  }
}

describe('plano do "zerar dados da conta"', () => {
  it('cada filtro usa campos e relações que existem', () => {
    for (const step of RESET_STEPS) {
      expect(() =>
        checkWhere(step.model, step.where('company-1')),
      ).not.toThrow();
    }
  });

  it('todo modelo ligado à empresa está classificado: apaga ou fica', () => {
    const planned = new Set(RESET_STEPS.map((s) => s.model));
    const unclassified = models
      .filter((m) => m.fields.some((f) => f.name === 'companyId'))
      .map((m) => m.name)
      .filter((name) => !planned.has(name) && !KEPT_MODELS.includes(name));
    expect(unclassified).toEqual([]);
  });

  it('nada fica e nada se apaga ao mesmo tempo', () => {
    const planned = new Set(RESET_STEPS.map((s) => s.model));
    expect(KEPT_MODELS.filter((name) => planned.has(name))).toEqual([]);
  });

  it.each(ALL_OPTIONS)(
    'nenhuma referência obrigatória aponta para o que sai, e o filho sai antes (%o)',
    (options) => {
      const steps = stepsFor(options);
      const firstIndex = new Map<string, number>();
      steps.forEach((step, index) => {
        if (!firstIndex.has(step.model)) firstIndex.set(step.model, index);
      });
      // Onde o modelo sai por último: é até aí que alguém pode apontar para ele.
      const lastIndex = new Map<string, number>();
      steps.forEach((step, index) => lastIndex.set(step.model, index));

      const problems: string[] = [];
      for (const target of new Set(steps.map((s) => s.model))) {
        for (const model of models) {
          for (const field of model.fields) {
            const pointing =
              field.kind === 'object' &&
              field.type === target &&
              (field.relationFromFields?.length ?? 0) > 0;
            // Cascade: o banco apaga junto. Opcional: o banco anula, salvo
            // quando a relação diz Restrict (a baixa direto na conta, sem
            // caixa, aponta assim para a conta bancária).
            const blocks = field.isRequired
              ? field.relationOnDelete !== 'Cascade'
              : ['Restrict', 'NoAction'].includes(field.relationOnDelete ?? '');
            if (!pointing || !blocks) continue;
            const childAt = firstIndex.get(model.name);
            if (childAt === undefined) {
              problems.push(
                `${model.name}.${field.name} fica e aponta para ${target}, que sai`,
              );
            } else if (childAt > lastIndex.get(target)!) {
              problems.push(`${model.name} sai depois de ${target}`);
            }
          }
        }
      }
      expect(problems).toEqual([]);
    },
  );
});
