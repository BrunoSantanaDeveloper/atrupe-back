import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { PlanConfigService } from './plan-config.service';

jest.mock('argon2', () => ({ verify: jest.fn() }));

const FEATURES = [
  {
    id: 'f-tabs',
    key: 'delivery_production_tabs',
    name: 'Abas de Produção na Agenda',
    description: null,
    category: 'delivery',
    price: 0,
    isActive: true,
  },
  {
    id: 'f-stage',
    key: 'delivery_stage_status_change',
    name: 'Alterar Status de Etapas',
    description: null,
    category: 'delivery',
    price: 0,
    isActive: true,
  },
  {
    id: 'f-cash',
    key: 'cash_control',
    name: 'Controle de Caixa',
    description: null,
    category: 'financial',
    price: 0,
    isActive: true,
  },
  {
    id: 'f-sectors',
    key: 'sectors_configuration',
    name: 'Configurar Setores',
    description: null,
    category: 'configuration',
    price: 0,
    isActive: true,
  },
  // Módulo pago e chave antiga: nunca entram na matriz.
  {
    id: 'f-nf',
    key: 'nota_fiscal',
    name: 'Nota Fiscal',
    description: null,
    category: 'fiscal',
    price: 7000,
    isActive: true,
  },
  {
    id: 'f-old',
    key: 'basic_management',
    name: 'Antiga',
    description: null,
    category: 'configuration',
    price: 0,
    isActive: true,
  },
];

const LITE = {
  id: 'plan-lite',
  name: 'Lite',
  planType: 'LITE',
  order: 2,
  isActive: true,
  basePrice: 23000,
  companyId: null,
};

/** Os planos globais, para a regra cumulativa (o Trial fica fora dela). */
const PLANS = {
  TRIAL: {
    ...LITE,
    id: 'plan-trial',
    name: 'Trial',
    planType: 'TRIAL',
    order: 0,
    basePrice: 0,
  },
  START: {
    ...LITE,
    id: 'plan-start',
    name: 'Start',
    planType: 'START',
    order: 1,
    basePrice: 14700,
  },
  LITE,
  PRO: {
    ...LITE,
    id: 'plan-pro',
    name: 'Pro',
    planType: 'PRO',
    order: 3,
    isActive: false,
  },
  ELITE: {
    ...LITE,
    id: 'plan-elite',
    name: 'Elite',
    planType: 'ELITE',
    order: 4,
    isActive: false,
  },
  FULL: {
    ...LITE,
    id: 'plan-full',
    name: 'Full',
    planType: 'FULL',
    order: 5,
    isActive: false,
  },
};

function buildPrisma() {
  const prisma: any = {
    // Sem dizer o contrário, a matriz só tem o Lite.
    plan: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([LITE]),
    },
    feature: { findMany: jest.fn().mockResolvedValue(FEATURES) },
    planFeature: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    planLimit: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    limit: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
    subscription: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    subscriptionFeature: {
      count: jest.fn().mockResolvedValue(0),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
    planConfigHistory: {
      create: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    subscriptionHistory: { create: jest.fn() },
    user: {
      findUnique: jest.fn().mockResolvedValue({
        name: 'Admin Atrupe',
        password: 'hash',
      }),
    },
    company: { findUnique: jest.fn() },
  };
  prisma.$transaction = jest.fn((fn: any) => fn(prisma));
  return prisma;
}

/** Estado do plano: quais chaves estão ligadas. */
const planState = (prisma: any, enabled: Record<string, boolean>) =>
  prisma.planFeature.findMany.mockResolvedValue(
    Object.entries(enabled).map(([key, isActive]) => ({
      isActive,
      feature: { key },
    })),
  );

/** Assinaturas atuais do plano. */
const currentSubscriptions = (prisma: any, ids: string[]) => {
  prisma.subscription.count.mockResolvedValue(ids.length);
  prisma.subscription.findMany.mockResolvedValue(ids.map((id) => ({ id })));
};

/**
 * A matriz em memória, plano a plano (só os planos listados entram nela). O
 * upsert altera a matriz e a transação desfaz tudo quando lança, como o banco.
 */
const useMatrix = (
  prisma: any,
  matrix: Record<string, Record<string, boolean>>,
  subscriptions: Record<string, string[]> = {},
) => {
  const plans = Object.values(PLANS);
  prisma.plan.findMany.mockImplementation(async () =>
    plans.filter((p) => p.id in matrix).sort((a, b) => a.order - b.order),
  );
  prisma.plan.findUnique.mockImplementation(
    async ({ where }) => plans.find((p) => p.id === where.id) ?? null,
  );
  prisma.planFeature.findMany.mockImplementation(async ({ where }) =>
    Object.entries(matrix[where.planId] ?? {}).map(([key, isActive]) => ({
      isActive,
      feature: { key },
    })),
  );
  prisma.planFeature.upsert.mockImplementation(async ({ where, update }) => {
    const { planId, featureId } = where.planId_featureId;
    const key = FEATURES.find((f) => f.id === featureId).key;
    matrix[planId] = { ...matrix[planId], [key]: update.isActive };
  });
  const ofPlan = (where: any) => subscriptions[where.planId] ?? [];
  prisma.subscription.count.mockImplementation(
    async ({ where }) => ofPlan(where).length,
  );
  prisma.subscription.findMany.mockImplementation(async ({ where }) =>
    ofPlan(where).map((id) => ({ id })),
  );
  const history: any[] = [];
  prisma.planConfigHistory.create.mockImplementation(async ({ data }) => {
    history.push(data);
    return data;
  });
  prisma.$transaction.mockImplementation(async (fn: any) => {
    const snapshot = JSON.stringify(matrix);
    const written = history.length;
    try {
      return await fn(prisma);
    } catch (error) {
      for (const planId of Object.keys(matrix)) delete matrix[planId];
      Object.assign(matrix, JSON.parse(snapshot));
      history.length = written;
      throw error;
    }
  });
  return { matrix, history };
};

describe('PlanConfigService', () => {
  let prisma: any;
  let service: PlanConfigService;
  const actor = { userId: 'admin-1' };

  beforeEach(() => {
    prisma = buildPrisma();
    prisma.plan.findUnique.mockResolvedValue(LITE);
    service = new PlanConfigService(prisma);
    (argon2.verify as jest.Mock).mockReset();
  });

  describe('matriz', () => {
    it('só entra recurso de plano que o código conhece: módulo pago e chave antiga ficam fora', async () => {
      prisma.plan.findMany.mockResolvedValue([LITE]);
      planState(prisma, { cash_control: true });

      const matrix = await service.getMatrix();

      expect(matrix.features.map((f) => f.key)).toEqual([
        'sectors_configuration',
        'delivery_production_tabs',
        'delivery_stage_status_change',
        'cash_control',
      ]);
      expect(matrix.plans[0].features).toEqual({
        sectors_configuration: false,
        delivery_production_tabs: false,
        delivery_stage_status_change: false,
        cash_control: true,
      });
      expect(
        matrix.features.find((f) => f.key === 'delivery_stage_status_change')
          .dependsOn,
      ).toEqual(['delivery_production_tabs']);
    });
  });

  describe('prévia', () => {
    it('incluir um recurso traz junto o que ele exige', async () => {
      planState(prisma, {});
      currentSubscriptions(prisma, ['s1', 's2']);

      const preview = await service.previewFeature(
        LITE.id,
        'delivery_stage_status_change',
        true,
      );

      expect(preview.changes).toEqual([
        {
          key: 'delivery_stage_status_change',
          name: 'Alterar Status de Etapas',
          enabled: true,
          cascade: false,
        },
        {
          key: 'delivery_production_tabs',
          name: 'Abas de Produção na Agenda',
          enabled: true,
          cascade: true,
        },
      ]);
      expect(preview.requiresCascade).toBe(true);
      expect(preview.currentSubscriptions).toBe(2);
      expect(preview.requiresChoice).toBe(false);
    });

    it('retirar um recurso com assinaturas pede a escolha', async () => {
      planState(prisma, { cash_control: true });
      currentSubscriptions(prisma, ['s1']);

      const preview = await service.previewFeature(
        LITE.id,
        'cash_control',
        false,
      );

      expect(preview.requiresChoice).toBe(true);
      expect(preview.affectedIfApplied).toBe(1);
      expect(preview.affectedIfKept).toBe(0);
    });
  });

  describe('incluir ou retirar recurso', () => {
    it('módulo pago não é configurável pela matriz', async () => {
      await expect(
        service.setFeature(actor, LITE.id, {
          featureKey: 'nota_fiscal',
          enabled: true,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('sem a cascata confirmada, recusa quando há dependência', async () => {
      planState(prisma, {});

      const error = await service
        .setFeature(actor, LITE.id, {
          featureKey: 'delivery_stage_status_change',
          enabled: true,
        })
        .catch((e) => e);

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect(error.getResponse().code).toBe('DEPENDENCY_REQUIRED');
      expect(prisma.planFeature.upsert).not.toHaveBeenCalled();
    });

    it('retirar com assinaturas exige a escolha sobre as atuais', async () => {
      planState(prisma, { cash_control: true });
      currentSubscriptions(prisma, ['s1', 's2']);

      const error = await service
        .setFeature(actor, LITE.id, {
          featureKey: 'cash_control',
          enabled: false,
        })
        .catch((e) => e);

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect(error.getResponse().code).toBe('CHOICE_REQUIRED');
    });

    it('retirar mantendo nas atuais não pede senha e cria o recurso mantido em cada uma', async () => {
      planState(prisma, { cash_control: true });
      currentSubscriptions(prisma, ['s1', 's2']);
      prisma.subscriptionFeature.createMany.mockResolvedValue({ count: 2 });

      const result = await service.setFeature(actor, LITE.id, {
        featureKey: 'cash_control',
        enabled: false,
        keepCurrentSubscriptions: true,
      });

      expect(argon2.verify).not.toHaveBeenCalled();
      expect(result).toEqual(
        expect.objectContaining({
          changed: true,
          affected: 0,
          retainedGrantsCreated: 2,
        }),
      );
      expect(prisma.planFeature.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            planId_featureId: { planId: LITE.id, featureId: 'f-cash' },
          },
          update: { isActive: false },
        }),
      );
      const grants = prisma.subscriptionFeature.createMany.mock.calls[0][0];
      expect(grants.skipDuplicates).toBe(true);
      expect(grants.data).toEqual([
        expect.objectContaining({
          subscriptionId: 's1',
          featureId: 'f-cash',
          price: 0,
          grantSource: 'PLAN_RETAINED',
        }),
        expect.objectContaining({
          subscriptionId: 's2',
          featureId: 'f-cash',
          grantSource: 'PLAN_RETAINED',
        }),
      ]);
      expect(prisma.planConfigHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'DISABLED',
            featureKey: 'cash_control',
            metadata: expect.objectContaining({
              keepCurrentSubscriptions: true,
              affectedSubscriptions: 0,
            }),
          }),
        }),
      );
    });

    it('retirar de todas as atuais exige a senha gerencial', async () => {
      planState(prisma, { cash_control: true });
      currentSubscriptions(prisma, ['s1']);

      const missing = await service
        .setFeature(actor, LITE.id, {
          featureKey: 'cash_control',
          enabled: false,
          keepCurrentSubscriptions: false,
        })
        .catch((e) => e);
      expect(missing).toBeInstanceOf(UnauthorizedException);
      expect(missing.getResponse().code).toBe('PASSWORD_REQUIRED');

      (argon2.verify as jest.Mock).mockResolvedValue(false);
      const wrong = await service
        .setFeature(actor, LITE.id, {
          featureKey: 'cash_control',
          enabled: false,
          keepCurrentSubscriptions: false,
          password: 'errada',
        })
        .catch((e) => e);
      expect(wrong.getResponse().code).toBe('INVALID_PASSWORD');
      expect(prisma.planFeature.upsert).not.toHaveBeenCalled();

      (argon2.verify as jest.Mock).mockResolvedValue(true);
      const result = await service.setFeature(actor, LITE.id, {
        featureKey: 'cash_control',
        enabled: false,
        keepCurrentSubscriptions: false,
        password: 'certa',
      });
      expect(result.affected).toBe(1);
      // Quem mantinha o recurso por uma retirada anterior também perde.
      expect(prisma.subscriptionFeature.deleteMany).toHaveBeenCalledWith({
        where: {
          featureId: { in: ['f-cash'] },
          grantSource: 'PLAN_RETAINED',
          subscription: { planId: LITE.id },
        },
      });
      expect(prisma.subscriptionFeature.createMany).not.toHaveBeenCalled();
    });

    it('incluir num plano sem assinaturas não pede senha', async () => {
      planState(prisma, {});
      currentSubscriptions(prisma, []);

      const result = await service.setFeature(actor, LITE.id, {
        featureKey: 'sectors_configuration',
        enabled: true,
      });

      expect(argon2.verify).not.toHaveBeenCalled();
      expect(result.changed).toBe(true);
      expect(prisma.planFeature.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { isActive: true } }),
      );
    });

    it('a contagem mudou desde a prévia: recusa com 409', async () => {
      planState(prisma, {});
      currentSubscriptions(prisma, ['s1', 's2', 's3']);

      await expect(
        service.setFeature(actor, LITE.id, {
          featureKey: 'sectors_configuration',
          enabled: true,
          expectedAffected: 2,
          password: 'x',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('pedido que não muda nada não grava', async () => {
      planState(prisma, { cash_control: true });

      const result = await service.setFeature(actor, LITE.id, {
        featureKey: 'cash_control',
        enabled: true,
      });

      expect(result.changed).toBe(false);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('regra cumulativa', () => {
    const cash = (cascade: boolean, crossPlan: boolean) => ({
      key: 'cash_control',
      name: 'Controle de Caixa',
      enabled: true,
      cascade,
      crossPlan,
    });

    it('incluir no Lite leva o recurso a Pro, Elite e Full que não o têm', async () => {
      useMatrix(
        prisma,
        {
          'plan-start': {},
          'plan-lite': {},
          'plan-pro': {},
          'plan-elite': { cash_control: true },
          'plan-full': {},
        },
        {
          'plan-lite': ['s1', 's2'],
          'plan-pro': ['s3'],
          'plan-elite': ['s4', 's5'],
        },
      );

      const preview = await service.previewFeature(
        LITE.id,
        'cash_control',
        true,
      );

      expect(preview.plans).toEqual([
        {
          planId: 'plan-lite',
          planName: 'Lite',
          planType: 'LITE',
          order: 2,
          currentSubscriptions: 2,
          changes: [cash(false, false)],
        },
        {
          planId: 'plan-pro',
          planName: 'Pro',
          planType: 'PRO',
          order: 3,
          currentSubscriptions: 1,
          changes: [cash(true, true)],
        },
        {
          planId: 'plan-full',
          planName: 'Full',
          planType: 'FULL',
          order: 5,
          currentSubscriptions: 0,
          changes: [cash(true, true)],
        },
      ]);
      // O campo antigo continua só com o plano pedido.
      expect(preview.changes).toEqual([
        {
          key: 'cash_control',
          name: 'Controle de Caixa',
          enabled: true,
          cascade: false,
        },
      ]);
      expect(preview.currentSubscriptions).toBe(2);
      expect(preview.affectedIfApplied).toBe(3);
      expect(preview.requiresCascade).toBe(true);
      expect(preview.blockedBy).toBeNull();
      expect(preview.noChange).toBe(false);
    });

    it('a dependência também sobe: o de cima recebe o que faltar dela', async () => {
      useMatrix(prisma, {
        'plan-lite': {},
        'plan-pro': { delivery_production_tabs: true },
        'plan-elite': {},
      });

      const preview = await service.previewFeature(
        LITE.id,
        'delivery_stage_status_change',
        true,
      );

      expect(
        preview.plans.map((p) => [
          p.planType,
          p.changes.map((c) => [c.key, c.cascade, c.crossPlan]),
        ]),
      ).toEqual([
        [
          'LITE',
          [
            ['delivery_stage_status_change', false, false],
            ['delivery_production_tabs', true, false],
          ],
        ],
        ['PRO', [['delivery_stage_status_change', true, true]]],
        [
          'ELITE',
          [
            ['delivery_stage_status_change', true, true],
            ['delivery_production_tabs', true, true],
          ],
        ],
      ]);
    });

    it('aplicar pede a cascata e grava em cada plano, com o histórico por plano', async () => {
      const { matrix, history } = useMatrix(
        prisma,
        {
          'plan-lite': {},
          'plan-pro': {},
          'plan-elite': { cash_control: true },
          'plan-full': {},
        },
        { 'plan-lite': ['s1'] },
      );

      const missing = await service
        .setFeature(actor, LITE.id, {
          featureKey: 'cash_control',
          enabled: true,
        })
        .catch((e) => e);
      expect(missing).toBeInstanceOf(UnprocessableEntityException);
      expect(missing.getResponse()).toEqual(
        expect.objectContaining({
          code: 'DEPENDENCY_REQUIRED',
          message:
            'Pela regra cumulativa, "Controle de Caixa" também entra nos planos Pro e Full.',
          changes: [
            {
              key: 'cash_control',
              name: 'Controle de Caixa',
              enabled: true,
              cascade: false,
            },
          ],
          plans: [
            expect.objectContaining({ planType: 'LITE' }),
            expect.objectContaining({ planType: 'PRO' }),
            expect.objectContaining({ planType: 'FULL' }),
          ],
        }),
      );
      expect(prisma.planFeature.upsert).not.toHaveBeenCalled();

      (argon2.verify as jest.Mock).mockResolvedValue(true);
      const result = await service.setFeature(actor, LITE.id, {
        featureKey: 'cash_control',
        enabled: true,
        cascade: true,
        expectedAffected: 1,
        password: 'certa',
      });

      expect(result).toEqual(
        expect.objectContaining({ changed: true, affected: 1 }),
      );
      expect(result.plans.map((p) => p.planType)).toEqual([
        'LITE',
        'PRO',
        'FULL',
      ]);
      expect(matrix).toEqual({
        'plan-lite': { cash_control: true },
        'plan-pro': { cash_control: true },
        'plan-elite': { cash_control: true },
        'plan-full': { cash_control: true },
      });
      // A retenção redundante sai em cada plano que ganhou o recurso.
      expect(
        prisma.subscriptionFeature.deleteMany.mock.calls.map(
          ([arg]) => arg.where.subscription.planId,
        ),
      ).toEqual(['plan-lite', 'plan-pro', 'plan-full']);
      expect(
        history.map((h) => [h.planType, h.featureKey, h.metadata.crossPlan]),
      ).toEqual([
        ['LITE', 'cash_control', false],
        ['PRO', 'cash_control', true],
        ['FULL', 'cash_control', true],
      ]);
      for (const row of history) {
        expect(row.metadata).toEqual(
          expect.objectContaining({
            requestedPlanId: 'plan-lite',
            requestedKey: 'cash_control',
            cascade: row.planType !== 'LITE',
          }),
        );
      }
      expect(history[1].description).toBe(
        '"Controle de Caixa" incluído no plano Pro — pela regra cumulativa, ao incluir "Controle de Caixa" no plano Lite',
      );
    });

    it('a senha e a prévia valem sobre a soma: o Lite sem assinaturas, o Pro com', async () => {
      useMatrix(
        prisma,
        { 'plan-lite': {}, 'plan-pro': {} },
        { 'plan-pro': ['s1', 's2'] },
      );

      const preview = await service.previewFeature(
        LITE.id,
        'cash_control',
        true,
      );
      expect(preview.currentSubscriptions).toBe(0);
      expect(preview.affectedIfApplied).toBe(2);

      const error = await service
        .setFeature(actor, LITE.id, {
          featureKey: 'cash_control',
          enabled: true,
          cascade: true,
        })
        .catch((e) => e);
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect(error.getResponse().code).toBe('PASSWORD_REQUIRED');

      await expect(
        service.setFeature(actor, LITE.id, {
          featureKey: 'cash_control',
          enabled: true,
          cascade: true,
          expectedAffected: 0,
          password: 'certa',
        }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.planFeature.upsert).not.toHaveBeenCalled();
    });

    it('retirar do Pro o que o Lite tem é recusado: retire primeiro do Lite', async () => {
      useMatrix(prisma, {
        'plan-start': {},
        'plan-lite': { cash_control: true },
        'plan-pro': { cash_control: true },
      });

      const preview = await service.previewFeature(
        'plan-pro',
        'cash_control',
        false,
      );
      expect(preview.blockedBy).toEqual([
        { planId: 'plan-lite', planName: 'Lite', planType: 'LITE' },
      ]);

      const error = await service
        .setFeature(actor, 'plan-pro', {
          featureKey: 'cash_control',
          enabled: false,
          keepCurrentSubscriptions: true,
        })
        .catch((e) => e);
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect(error.getResponse()).toEqual({
        code: 'LOWER_PLAN_HAS_FEATURE',
        feature: 'cash_control',
        plans: [{ planId: 'plan-lite', planName: 'Lite', planType: 'LITE' }],
        message: 'Retire primeiro "Controle de Caixa" do plano Lite.',
      });
      expect(prisma.planFeature.upsert).not.toHaveBeenCalled();
    });

    it('retirar do plano mais baixo que tem o recurso vale só para ele', async () => {
      const { matrix } = useMatrix(prisma, {
        'plan-start': {},
        'plan-lite': { cash_control: true },
        'plan-pro': { cash_control: true },
      });

      const result = await service.setFeature(actor, LITE.id, {
        featureKey: 'cash_control',
        enabled: false,
      });

      expect(result.plans.map((p) => p.planType)).toEqual(['LITE']);
      expect(matrix['plan-lite'].cash_control).toBe(false);
      expect(matrix['plan-pro'].cash_control).toBe(true);
    });

    it('o Trial muda sozinho: não leva o recurso a ninguém nem é barrado pelos de baixo', async () => {
      const { matrix } = useMatrix(prisma, {
        'plan-trial': { cash_control: true },
        'plan-start': { cash_control: true },
        'plan-lite': { cash_control: true },
      });

      const removal = await service.previewFeature(
        'plan-trial',
        'cash_control',
        false,
      );
      expect(removal.blockedBy).toBeNull();
      await service.setFeature(actor, 'plan-trial', {
        featureKey: 'cash_control',
        enabled: false,
      });

      const inclusion = await service.previewFeature(
        'plan-trial',
        'sectors_configuration',
        true,
      );
      expect(inclusion.plans.map((p) => p.planType)).toEqual(['TRIAL']);
      expect(inclusion.requiresCascade).toBe(false);
      await service.setFeature(actor, 'plan-trial', {
        featureKey: 'sectors_configuration',
        enabled: true,
      });

      expect(matrix).toEqual({
        'plan-trial': { cash_control: false, sectors_configuration: true },
        'plan-start': { cash_control: true },
        'plan-lite': { cash_control: true },
      });
    });
  });

  describe('limites', () => {
    beforeEach(() => {
      prisma.limit.findUnique.mockResolvedValue({
        id: 'l-users',
        key: 'max_users',
        name: 'Máximo de Usuários',
      });
    });

    it('recusa valor abaixo do mínimo', async () => {
      await expect(
        service.setLimit(actor, LITE.id, { limitKey: 'max_users', value: 0 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('valor igual ao atual não grava', async () => {
      prisma.planLimit.findUnique.mockResolvedValue({
        value: 5,
        isActive: true,
      });

      const result = await service.setLimit(actor, LITE.id, {
        limitKey: 'max_users',
        value: 5,
      });
      expect(result.changed).toBe(false);
    });

    it('mudar o limite de um plano com assinaturas pede senha e registra', async () => {
      prisma.planLimit.findUnique.mockResolvedValue({
        value: 5,
        isActive: true,
      });
      currentSubscriptions(prisma, ['s1']);
      (argon2.verify as jest.Mock).mockResolvedValue(true);

      await service.setLimit(actor, LITE.id, {
        limitKey: 'max_users',
        value: 6,
        password: 'certa',
      });

      expect(prisma.planLimit.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { value: 6, isActive: true } }),
      );
      expect(prisma.planConfigHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'VALUE_CHANGED',
            limitKey: 'max_users',
            changes: { before: { value: 5 }, after: { value: 6 } },
          }),
        }),
      );
    });
  });

  describe('cortesia por empresa', () => {
    beforeEach(() => {
      prisma.subscription.findMany.mockResolvedValue([
        {
          id: 'sub-1',
          status: 'ACTIVE',
          planId: 'plan-start',
          plan: { name: 'Start', planType: 'START' },
        },
      ]);
    });

    it('conceder exige motivo', async () => {
      await expect(
        service.setCompanyFeature(actor, 'company-1', {
          featureKey: 'cash_control',
          enabled: true,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('recurso que o plano já inclui não vira cortesia', async () => {
      prisma.planFeature.findFirst.mockResolvedValue({ id: 'pf-1' });

      const error = await service
        .setCompanyFeature(actor, 'company-1', {
          featureKey: 'cash_control',
          enabled: true,
          reason: 'Teste',
        })
        .catch((e) => e);
      expect(error.getResponse().code).toBe('FEATURE_IN_PLAN');
    });

    it('concede com senha e registra na assinatura', async () => {
      (argon2.verify as jest.Mock).mockResolvedValue(true);

      await service.setCompanyFeature(actor, 'company-1', {
        featureKey: 'cash_control',
        enabled: true,
        reason: 'Parceria de lançamento',
        password: 'certa',
      });

      expect(prisma.subscriptionFeature.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            subscriptionId: 'sub-1',
            featureId: 'f-cash',
            price: 0,
            grantSource: 'COURTESY',
            grantReason: 'Parceria de lançamento',
          }),
        }),
      );
      expect(prisma.subscriptionHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'COURTESY_GRANTED' }),
        }),
      );
    });
  });

  describe('padrão de fábrica', () => {
    it('restaurar o Lite liga o que falta e pede senha com assinaturas', async () => {
      planState(prisma, {
        sectors_configuration: true,
        delivery_production_tabs: true,
        delivery_stage_status_change: true,
        cash_control: false,
      });
      currentSubscriptions(prisma, ['s1']);

      const diff = await service.defaultsDiff(LITE.id);
      expect(diff.enable.map((f) => f.key)).toEqual(['cash_control']);
      expect(diff.disable).toEqual([]);

      await expect(service.restoreDefaults(actor, LITE.id, {})).rejects.toThrow(
        UnauthorizedException,
      );

      (argon2.verify as jest.Mock).mockResolvedValue(true);
      const result = await service.restoreDefaults(actor, LITE.id, {
        password: 'certa',
      });
      expect(result).toEqual({ changed: true, affected: 1 });
    });

    it('restaurar um padrão que deixaria a matriz fora da regra cumulativa é recusado e nada é gravado', async () => {
      // O padrão do Start tem Setores; o Lite foi configurado sem.
      const { matrix, history } = useMatrix(prisma, {
        'plan-start': {},
        'plan-lite': { cash_control: true },
        'plan-pro': { cash_control: true, sectors_configuration: true },
      });
      const before = JSON.parse(JSON.stringify(matrix));

      const error = await service
        .restoreDefaults(actor, 'plan-start', {})
        .catch((e) => e);

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect(error.getResponse()).toEqual(
        expect.objectContaining({
          code: 'NOT_CUMULATIVE',
          violations: [
            {
              lowerPlan: {
                planId: 'plan-start',
                planName: 'Start',
                planType: 'START',
              },
              higherPlan: {
                planId: 'plan-lite',
                planName: 'Lite',
                planType: 'LITE',
              },
              keys: ['sectors_configuration'],
            },
          ],
        }),
      );
      expect(error.getResponse().message).toContain(
        'o Lite não tem "Configurar Setores", que o Start tem',
      );
      // A transação foi desfeita: a matriz e o histórico ficam como estavam.
      expect(prisma.planFeature.upsert).toHaveBeenCalled();
      expect(matrix).toEqual(before);
      expect(history).toEqual([]);
    });

    it('restaurar o Trial não confere a regra (ele está fora dela)', async () => {
      useMatrix(prisma, {
        'plan-trial': {},
        'plan-start': { sectors_configuration: true },
        // Violação que já existia entre Lite e Pro não trava o Trial.
        'plan-lite': { sectors_configuration: true, cash_control: true },
        'plan-pro': { sectors_configuration: true },
      });

      const result = await service.restoreDefaults(actor, 'plan-trial', {});

      expect(result).toEqual({ changed: true, affected: 0 });
    });
  });

  describe('preço', () => {
    it('o Trial não tem preço', async () => {
      prisma.plan.findUnique.mockResolvedValue({ ...LITE, planType: 'TRIAL' });
      await expect(
        service.setPricing(actor, LITE.id, {
          basePrice: 1000,
          additionalUserPrice: 0,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('plano liberado não fica com mensalidade zero', async () => {
      await expect(
        service.setPricing(actor, LITE.id, {
          basePrice: 0,
          additionalUserPrice: 1500,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('com assinaturas pede senha, grava e registra antes e depois', async () => {
      prisma.plan.findUnique.mockResolvedValue({
        ...LITE,
        additionalUserPrice: 1500,
      });
      prisma.plan.update = jest.fn();
      currentSubscriptions(prisma, ['s1', 's2']);

      await expect(
        service.setPricing(actor, LITE.id, {
          basePrice: 25000,
          additionalUserPrice: 1500,
        }),
      ).rejects.toThrow(UnauthorizedException);

      (argon2.verify as jest.Mock).mockResolvedValue(true);
      const result = await service.setPricing(actor, LITE.id, {
        basePrice: 25000,
        additionalUserPrice: 1500,
        password: 'certa',
      });

      expect(result).toEqual({ changed: true, affected: 2 });
      expect(prisma.plan.update).toHaveBeenCalledWith({
        where: { id: LITE.id },
        data: { basePrice: 25000, additionalUserPrice: 1500 },
      });
      expect(prisma.planConfigHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'PRICE_CHANGED',
            changes: {
              before: { basePrice: 23000, additionalUserPrice: 1500 },
              after: { basePrice: 25000, additionalUserPrice: 1500 },
            },
          }),
        }),
      );
    });

    it('preço igual não grava', async () => {
      prisma.plan.findUnique.mockResolvedValue({
        ...LITE,
        additionalUserPrice: 1500,
      });
      const result = await service.setPricing(actor, LITE.id, {
        basePrice: 23000,
        additionalUserPrice: 1500,
      });
      expect(result.changed).toBe(false);
    });
  });

  describe('textos da trilha e tabela comparativa', () => {
    it('grava os textos sem senha e ignora itens vazios', async () => {
      prisma.plan.update = jest.fn();
      await service.setPresentation(actor, LITE.id, {
        pitch: '  Para quem quer previsibilidade.  ',
        actions: ['Contas a receber', '  ', 'Limite de crédito'],
      });
      expect(argon2.verify).not.toHaveBeenCalled();
      expect(prisma.plan.update).toHaveBeenCalledWith({
        where: { id: LITE.id },
        data: {
          presentation: {
            pitch: 'Para quem quer previsibilidade.',
            actions: ['Contas a receber', 'Limite de crédito'],
          },
        },
      });
    });

    it('sem tabela salva, vale o padrão', async () => {
      prisma.systemSetting = { findUnique: jest.fn().mockResolvedValue(null) };
      const comparison = await service.getComparison();
      expect(comparison.isDefault).toBe(true);
      expect(comparison.groups.length).toBeGreaterThan(0);
    });

    it('tabela sem nenhuma linha é recusada', async () => {
      prisma.systemSetting = { findUnique: jest.fn().mockResolvedValue(null) };
      await expect(
        service.setComparison(actor, {
          groups: [{ group: 'Financeiro', rows: [] }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('salva a tabela no system_settings e registra', async () => {
      prisma.systemSetting = {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
      };
      await service.setComparison(actor, {
        groups: [
          {
            group: ' Financeiro ',
            rows: [{ label: 'Contas a pagar', since: 'LITE' }],
          },
        ],
      });
      expect(prisma.systemSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'plan_comparison' },
          update: {
            value: {
              groups: [
                {
                  group: 'Financeiro',
                  rows: [{ label: 'Contas a pagar', since: 'LITE' }],
                },
              ],
            },
          },
        }),
      );
      expect(prisma.planConfigHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'COMPARISON_CHANGED' }),
        }),
      );
    });
  });
});
