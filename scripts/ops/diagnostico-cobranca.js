'use strict';
/*
 * Diagnóstico: assinaturas que cobram diferente do que liberam.
 *
 * SOMENTE LEITURA — consulta o banco (findMany) e o Asaas (GET). Não altera
 * nada, nem no banco nem no Asaas.
 *
 * Roda dentro do container da API, que já tem o Prisma gerado, o axios e a
 * configuração do Asaas:
 *   docker exec -i <container> node - < diagnostico-cobranca.js
 *
 * DIAG_SELFTEST=1 roda só os testes das contas, sem banco nem Asaas.
 */
// CommonJS de propósito: roda com `node -` no container, fora do build.
/* eslint-disable @typescript-eslint/no-var-requires */

const PAID = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH']);
const cents = (reais) => Math.round(Number(reais || 0) * 100);
const brl = (c) =>
  c == null ? '-' : `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;
const day = (d) =>
  d ? String(d instanceof Date ? d.toISOString() : d).slice(0, 10) : '-';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * O conjunto de módulos e usuários adicionais cuja soma explica a diferença
 * — o menor que bater, ao centavo.
 */
function explainGap(gap, modules, users, userPrice) {
  let best = null;
  const n = Math.min(modules.length, 10);
  for (let mask = 0; mask < 1 << n; mask++) {
    let sum = 0;
    const names = [];
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        sum += modules[i].price;
        names.push(`${modules[i].name} (${brl(modules[i].price)})`);
      }
    }
    for (let k = 0; k <= users; k++) {
      if (!mask && !k) continue;
      if (Math.abs(sum + k * userPrice - gap) > 1) continue;
      const parts = [...names];
      if (k)
        parts.push(`${k} usuário(s) adicional(is) (${brl(k * userPrice)})`);
      const size = names.length + (k ? 1 : 0);
      if (!best || size < best.size) {
        best = {
          size,
          parts,
          modules: modules.filter((_, i) => mask & (1 << i)),
          users: k,
        };
      }
    }
  }
  return best;
}

/** Quanto cada mensalidade paga deixou de cobrar do que estava liberado. */
function estimateShortfall({
  payments,
  base,
  modules,
  usersCents,
  planName,
  skipFirst,
}) {
  const paid = payments
    .filter((p) => PAID.has(p.status))
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  let total = 0;
  let cycles = 0;
  paid.forEach((p, index) => {
    if (skipFirst && index === 0) return;
    // Paga num plano anterior: a comparação com o plano de hoje não vale.
    if (p.description && planName && !p.description.includes(planName)) return;
    const due = new Date(`${String(p.dueDate).slice(0, 10)}T12:00:00Z`);
    const expectedAt =
      base +
      modules
        .filter((m) => new Date(m.since) <= due)
        .reduce((s, m) => s + m.price, 0) +
      usersCents;
    const shortfall = expectedAt - cents(p.value);
    if (shortfall > 1) {
      total += shortfall;
      cycles++;
    }
  });
  return { total, cycles };
}

function selftest() {
  const assert = require('assert');
  const nf = { name: 'Nota Fiscal', price: 7000, since: '2026-01-10' };
  const orc = { name: 'Orçamentos', price: 5000, since: '2026-02-10' };
  assert.deepStrictEqual(explainGap(7000, [nf, orc], 0, 1500).parts, [
    'Nota Fiscal (R$ 70,00)',
  ]);
  assert.deepStrictEqual(explainGap(3000, [nf], 3, 1500).parts, [
    '2 usuário(s) adicional(is) (R$ 30,00)',
  ]);
  assert.deepStrictEqual(explainGap(8500, [nf, orc], 1, 1500).parts, [
    'Nota Fiscal (R$ 70,00)',
    '1 usuário(s) adicional(is) (R$ 15,00)',
  ]);
  assert.strictEqual(explainGap(1234, [nf], 0, 1500), null);
  const payments = [
    {
      status: 'RECEIVED',
      dueDate: '2026-01-05',
      value: 147,
      description: 'Assinatura Atrupe Start',
    },
    {
      status: 'RECEIVED',
      dueDate: '2026-02-05',
      value: 147,
      description: 'Assinatura Atrupe Start',
    },
    {
      status: 'RECEIVED',
      dueDate: '2026-03-05',
      value: 217,
      description: 'Assinatura Atrupe Start',
    },
    {
      status: 'PENDING',
      dueDate: '2026-04-05',
      value: 147,
      description: 'Assinatura Atrupe Start',
    },
    {
      status: 'RECEIVED',
      dueDate: '2025-12-05',
      value: 99,
      description: 'Assinatura Atrupe Lite',
    },
  ];
  // NF desde 10/01: fevereiro saiu sem ela (uma mensalidade, R$ 70); março
  // cobrou; abril está pendente; dezembro foi de outro plano.
  assert.deepStrictEqual(
    estimateShortfall({
      payments,
      base: 14700,
      modules: [nf],
      usersCents: 0,
      planName: 'Atrupe Start',
      skipFirst: false,
    }),
    { total: 7000, cycles: 1 },
  );
  console.log('selftest ok');
}

async function main() {
  const { PrismaClient } = require('@prisma/client');
  const axios = require('axios');
  const prisma = new PrismaClient();

  // A mesma configuração que a API usa (system_settings, senão o .env).
  const setting = await prisma.systemSetting.findUnique({
    where: { key: 'asaas_config' },
  });
  let env, url, token;
  if (setting && setting.value && setting.value.environment) {
    env = setting.value.environment;
    url = setting.value[env].url;
    token = setting.value[env].token;
  } else {
    token = process.env.ASAAS_TOKEN || '';
    env = token.includes('_prod_') ? 'production' : 'sandbox';
    url =
      process.env.ASAAS_API_URL ||
      (env === 'production'
        ? 'https://api.asaas.com/v3'
        : 'https://api-sandbox.asaas.com/v3');
  }
  const api = axios.create({
    baseURL: url,
    timeout: 20000,
    headers: { access_token: token, 'User-Agent': 'Atrupe-diagnostico' },
  });
  // Só leitura: nenhum outro verbo sai daqui.
  const get = async (path, params) => {
    await sleep(150);
    try {
      return (await api.get(path, { params })).data;
    } catch (e) {
      if (e.response && e.response.status === 404) return null;
      throw new Error(
        `GET ${path}: ${e.response ? `${e.response.status} ${JSON.stringify(e.response.data)}` : e.message}`,
      );
    }
  };
  const pages = async (path, params = {}) => {
    const out = [];
    for (let offset = 0; ; offset += 100) {
      const page = await get(path, { ...params, limit: 100, offset });
      if (!page) break;
      out.push(...(page.data || []));
      if (!page.hasMore) break;
    }
    return out.filter((item) => !item.deleted);
  };

  const subs = await prisma.subscription.findMany({
    where: { status: 'ACTIVE', plan: { planType: { not: 'TRIAL' } } },
    include: {
      plan: {
        select: {
          name: true,
          planType: true,
          basePrice: true,
          additionalUserPrice: true,
          planFeatures: { select: { feature: { select: { key: true } } } },
        },
      },
      subscriptionFeatures: {
        include: { feature: { select: { key: true, name: true } } },
      },
      coupon: {
        select: {
          code: true,
          discountType: true,
          discountValue: true,
          durationType: true,
        },
      },
      Company: { select: { id: true, name: true, blockLevel: true } },
      history: {
        where: {
          action: {
            in: [
              'MODULE_ADDED',
              'MODULE_REMOVED',
              'COMPLEMENTS_ADDED',
              'COUPON_EXPIRED',
            ],
          },
        },
        orderBy: { createdAt: 'asc' },
        select: {
          action: true,
          createdAt: true,
          description: true,
          metadata: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  const rows = [];
  const add = (sub, kind, text, extra = {}) =>
    rows.push({
      kind,
      company: (sub.Company && sub.Company.name) || '(sem empresa)',
      companyId: sub.companyId,
      subscriptionId: sub.id,
      asaasId: sub.asaasSubscriptionId,
      plan: sub.plan.name,
      text,
      ...extra,
    });

  let checked = 0;
  const localBySubId = new Map();
  const activeCount = new Map();
  for (const sub of subs) {
    if (sub.companyId)
      activeCount.set(sub.companyId, (activeCount.get(sub.companyId) || 0) + 1);
  }

  for (const sub of subs) {
    localBySubId.set(sub.asaasSubscriptionId, sub);
    const inPlan = new Set(
      sub.plan.planFeatures
        .map((pf) => pf.feature && pf.feature.key)
        .filter(Boolean),
    );
    const modules = sub.subscriptionFeatures
      .filter((sf) => sf.isActive !== false && sf.feature)
      .map((sf) => ({
        key: sf.feature.key,
        name: sf.feature.name,
        price: Math.round(sf.price || 0),
        since: sf.createdAt,
        inPlan: inPlan.has(sf.feature.key),
      }));
    const base = Math.round(sub.plan.basePrice || 0);
    const userPrice = Math.round(sub.plan.additionalUserPrice || 0);
    const usersCents = (sub.additionalUsers || 0) * userPrice;
    const monthly =
      base + modules.reduce((s, m) => s + m.price, 0) + usersCents;
    const yearly = sub.cycle === 'YEARLY';
    const expected = yearly ? monthly * 11 : monthly;
    const composition = [
      `plano ${brl(base)}`,
      ...modules.map((m) => `${m.name} ${brl(m.price)}`),
      ...(sub.additionalUsers
        ? [`${sub.additionalUsers} usuário(s) ${brl(usersCents)}`]
        : []),
    ].join(' + ');
    const localCents = cents(sub.value);

    if ((activeCount.get(sub.companyId) || 0) > 1) {
      add(
        sub,
        'DUAS_ATIVAS',
        'A empresa tem mais de uma assinatura paga ativa no banco.',
      );
    }
    for (const m of modules.filter((m) => m.inPlan)) {
      add(
        sub,
        'MODULO_INCLUSO_COBRADO',
        `${m.name} faz parte do plano e também é cobrado à parte (${brl(m.price)}).`,
      );
    }
    if (sub.value > 5000) {
      add(
        sub,
        'VALOR_EM_CENTAVOS',
        `O banco guarda ${sub.value} como valor mensal — parece estar em centavos.`,
        { expected, local: localCents },
      );
    }

    const installment =
      sub.billingMode === 'ASAAS_INSTALLMENT' ||
      sub.asaasSubscriptionId.startsWith('inst_');
    if (installment) continue; // anual parcelado: fluxo novo, cobrado por parcelamento
    if (!sub.asaasSubscriptionId.startsWith('sub_')) {
      add(
        sub,
        'FORA_DO_ASAAS',
        `Acesso liberado sem cobrança automática (id ${sub.asaasSubscriptionId.split('_')[0]}_…): ${composition} = ${brl(expected)}.`,
        { expected, local: localCents },
      );
      continue;
    }

    checked++;
    const remote = await get(`/subscriptions/${sub.asaasSubscriptionId}`);
    if (!remote) {
      add(
        sub,
        'ACESSO_SEM_COBRANCA',
        'A assinatura não existe no Asaas: acesso liberado sem nada cobrando.',
        { expected, local: localCents },
      );
      continue;
    }
    if (remote.deleted || remote.status !== 'ACTIVE') {
      add(
        sub,
        'ACESSO_SEM_COBRANCA',
        `No Asaas a assinatura está ${remote.deleted ? 'removida' : remote.status}: acesso liberado sem cobrança ativa.`,
        { expected, local: localCents, asaas: cents(remote.value) },
      );
      continue;
    }

    const asaasCents = cents(remote.value);
    const payments = await pages(
      `/subscriptions/${sub.asaasSubscriptionId}/payments`,
    );
    const pending = payments
      .filter((p) => p.status === 'PENDING')
      .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
    const overdue = payments.filter((p) => p.status === 'OVERDUE');
    const next = pending[0];
    const common = {
      expected,
      local: localCents,
      asaas: asaasCents,
      next: next ? cents(next.value) : null,
      nextDue: next ? next.dueDate : null,
    };

    if (remote.description && !remote.description.includes(sub.plan.name)) {
      add(
        sub,
        'PLANO_DIFERENTE',
        `O Asaas descreve "${remote.description}", o banco diz ${sub.plan.name}.`,
        common,
      );
    }

    const gap = expected - asaasCents;
    if (gap > 1) {
      const match = yearly
        ? null
        : explainGap(gap, modules, sub.additionalUsers || 0, userPrice);
      const since =
        match && match.modules.length
          ? day(
              match.modules
                .map((m) => new Date(m.since))
                .sort((a, b) => a - b)[0],
            )
          : null;
      const cause = match
        ? `corresponde a ${match.parts.join(' + ')}${since ? `, liberado(s) desde ${since}` : ''}`
        : 'não corresponde a módulo ou usuário: preço do plano mudou, cupom ou ajuste manual';
      const shortfall =
        !yearly && !sub.coupon
          ? estimateShortfall({
              payments,
              base,
              modules,
              usersCents,
              planName: sub.plan.name,
              skipFirst: !!sub.contractedAt,
            })
          : null;
      add(
        sub,
        sub.coupon ? 'COM_CUPOM' : 'COBRA_MENOS',
        `Libera ${composition} = ${brl(expected)}, o Asaas cobra ${brl(asaasCents)}: faltam ${brl(gap)}/${yearly ? 'ano' : 'mês'} — ${cause}.` +
          (sub.coupon
            ? ` Cupom ${sub.coupon.code} (${sub.coupon.discountType} ${sub.coupon.discountValue}, ${sub.coupon.durationType}).`
            : ''),
        {
          ...common,
          gap,
          shortfall: shortfall ? shortfall.total : null,
          cyclesShort: shortfall ? shortfall.cycles : null,
        },
      );
    } else if (gap < -1) {
      const removed = sub.history
        .filter((h) => h.action === 'MODULE_REMOVED')
        .map((h) => `${day(h.createdAt)}: ${h.description}`);
      add(
        sub,
        'COBRA_MAIS',
        `Libera ${composition} = ${brl(expected)}, o Asaas cobra ${brl(asaasCents)}: ${brl(-gap)}/${yearly ? 'ano' : 'mês'} a mais.` +
          (removed.length
            ? ` Retiradas registradas: ${removed.join('; ')}.`
            : ''),
        { ...common, gap },
      );
    } else if (!sub.contractedAt) {
      // Em dia hoje; conta antiga pode ter tido mensalidade sem o módulo novo.
      const shortfall = sub.coupon
        ? null
        : estimateShortfall({
            payments,
            base,
            modules,
            usersCents,
            planName: sub.plan.name,
            skipFirst: false,
          });
      if (shortfall && shortfall.total > 1) {
        add(
          sub,
          'CICLO_SEM_COBRAR',
          `Hoje cobra certo (${brl(asaasCents)}), mas ${shortfall.cycles} mensalidade(s) paga(s) saíram sem o que já estava liberado.`,
          {
            ...common,
            shortfall: shortfall.total,
            cyclesShort: shortfall.cycles,
          },
        );
      }
    }

    if (Math.abs(localCents - asaasCents) > 1 && sub.value <= 5000) {
      add(
        sub,
        'BANCO_DIFERENTE_DO_ASAAS',
        `O banco diz ${brl(localCents)}, o Asaas cobra ${brl(asaasCents)}.`,
        common,
      );
    }
    if (next && Math.abs(cents(next.value) - asaasCents) > 1) {
      add(
        sub,
        'MENSALIDADE_GERADA_DIFERENTE',
        `A mensalidade já gerada (${day(next.dueDate)}) está com ${brl(cents(next.value))}; a assinatura, com ${brl(asaasCents)}.`,
        common,
      );
    }
    if (overdue.length) {
      add(
        sub,
        'EM_ATRASO',
        `${overdue.length} cobrança(s) vencida(s) no Asaas.`,
        common,
      );
    }
  }

  // O outro sentido: o Asaas cobra, e o sistema não tem assinatura ativa.
  const remoteActive = await pages('/subscriptions', { status: 'ACTIVE' });
  const orphan = [];
  for (const remote of remoteActive) {
    if (localBySubId.has(remote.id)) continue;
    const local = await prisma.subscription.findFirst({
      where: { asaasSubscriptionId: remote.id },
      select: {
        id: true,
        status: true,
        companyId: true,
        Company: { select: { name: true } },
        plan: { select: { name: true } },
      },
    });
    orphan.push({
      kind: 'COBRA_SEM_ACESSO',
      company: local
        ? (local.Company && local.Company.name) || '(sem empresa)'
        : '(sem registro no sistema)',
      companyId: local ? local.companyId : null,
      subscriptionId: local ? local.id : null,
      asaasId: remote.id,
      plan: local ? local.plan.name : '-',
      text: local
        ? `O Asaas segue cobrando ${brl(cents(remote.value))} (próx. ${day(remote.nextDueDate)}), mas no sistema a assinatura está ${local.status}.`
        : `O Asaas cobra ${brl(cents(remote.value))} (próx. ${day(remote.nextDueDate)}, "${remote.description || ''}") de uma assinatura que o sistema não conhece.`,
      asaas: cents(remote.value),
    });
  }
  rows.push(...orphan);

  // Relatório.
  const order = [
    'COBRA_MENOS',
    'COM_CUPOM',
    'ACESSO_SEM_COBRANCA',
    'CICLO_SEM_COBRAR',
    'COBRA_MAIS',
    'COBRA_SEM_ACESSO',
    'BANCO_DIFERENTE_DO_ASAAS',
    'MENSALIDADE_GERADA_DIFERENTE',
    'PLANO_DIFERENTE',
    'VALOR_EM_CENTAVOS',
    'MODULO_INCLUSO_COBRADO',
    'DUAS_ATIVAS',
    'FORA_DO_ASAAS',
    'EM_ATRASO',
  ];
  console.log(`== Diagnóstico de cobrança x acesso — ${day(new Date())}`);
  console.log(`Asaas: ${env} (${new URL(url).host})`);
  console.log(
    `Assinaturas pagas ativas no banco: ${subs.length}; conferidas no Asaas: ${checked}; ativas no Asaas: ${remoteActive.length}`,
  );
  for (const kind of order) {
    const list = rows.filter((r) => r.kind === kind);
    if (!list.length) continue;
    console.log(`\n[${kind}] ${list.length}`);
    for (const r of list) {
      const loss = r.shortfall
        ? ` | não cobrado estimado: ${brl(r.shortfall)} em ${r.cyclesShort} mensalidade(s)`
        : '';
      console.log(`- ${r.company} | ${r.plan} | ${r.text}${loss}`);
    }
  }
  const totalMonthly = rows
    .filter((r) => r.kind === 'COBRA_MENOS')
    .reduce((s, r) => s + (r.gap || 0), 0);
  const totalPast = rows
    .filter((r) => ['COBRA_MENOS', 'CICLO_SEM_COBRAR'].includes(r.kind))
    .reduce((s, r) => s + (r.shortfall || 0), 0);
  console.log(
    `\nDeixando de cobrar hoje (sem cupom): ${brl(totalMonthly)}/mês. Estimativa do que já deixou de ser cobrado: ${brl(totalPast)}.`,
  );

  console.log('\n-----CSV-----');
  console.log(
    'tipo;empresa;companyId;subscriptionId;asaasId;plano;esperado;banco;asaas;proxima;venc_proxima;diferenca;nao_cobrado_estimado;mensalidades;detalhe',
  );
  for (const r of rows) {
    console.log(
      [
        r.kind,
        r.company,
        r.companyId,
        r.subscriptionId,
        r.asaasId,
        r.plan,
        r.expected,
        r.local,
        r.asaas,
        r.next,
        r.nextDue ? day(r.nextDue) : '',
        r.gap,
        r.shortfall,
        r.cyclesShort,
        r.text.replace(/;/g, ','),
      ]
        .map((v) => (v == null ? '' : String(v)))
        .join(';'),
    );
  }
  console.log('-----FIM-----');
  await prisma.$disconnect();
}

if (process.env.DIAG_SELFTEST) {
  selftest();
} else {
  main().catch((error) => {
    console.error('Falhou:', error.message);
    process.exit(1);
  });
}
