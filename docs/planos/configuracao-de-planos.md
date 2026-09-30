# Configuração dos planos pelo superadmin

Desde 29/09/2026 a composição de cada plano (quais recursos ele inclui e os
limites) é **dado**, editado em *Super Admin › Sistema › Planos*. O código
continua dono das **chaves**: o que cada uma libera, de quais outras depende e
onde é bloqueada.

## Onde fica cada coisa

| O quê | Onde |
|---|---|
| Composição real de cada plano | tabelas `plan_features` (`isActive` por par plano × recurso) e `plan_limits` |
| Padrão de fábrica (o que o seed cria e o "Restaurar padrão" reaplica) | `src/seeds/plans-complete.ts` |
| Catálogo de recursos (nome, categoria, preço) | `src/seeds/features-base.ts` |
| Chaves conhecidas, dependências, onde cada uma é bloqueada | `src/core/plan/plan-feature-rules.ts` |
| API do painel | `src/core/plan/plan-config.controller.ts` e `plan-config.service.ts` (rotas `plan/config/*`, só SystemAdmin) |
| O que vale para a empresa em runtime | `PlanControlService.getCompanyPlanInfo`: plano (`plan_features.isActive`) + recursos da assinatura (`subscription_features`, dentro da validade) |
| Trilha das mudanças | tabela `plan_config_history` (e `subscription_history` para cortesias) |

## Regras de produto (PO, 29/09/2026)

- Módulos pagos (preço > 0, como a Nota Fiscal) **não entram** na matriz.
- Incluir um recurso vale na hora para as assinaturas atuais do plano.
- Ao **retirar**, o superadmin responde se atinge as assinaturas atuais. Se
  não, cada assinatura atual (ACTIVE ou BLOCKED) recebe o recurso como
  `subscription_features` com `grantSource = PLAN_RETAINED` e preço zero; só as
  novas contratações ficam sem ele.
- A senha gerencial só é pedida quando a alteração atinge assinaturas.
- Setores nasce no Start; o Trial é uma coluna editável (nasce com o que o
  Start tem).
- O Start recebe **403** na API dos recursos que o plano não inclui
  (`code: FEATURE_NOT_AVAILABLE`, com o nome do recurso na mensagem).

## O seed não apaga mais nada

`scripts/start.sh` roda o seed a cada subida do container. Até 29/09 ele
apagava e recriava `plan_features`/`plan_limits`; agora
(`src/seeds/apply-plan-config.ts`) só **cria a linha que falta** e nunca toca
na existente. O log do container traz uma linha `[seed] planos: ...` com o que
foi criado e o que o painel configurou diferente do padrão.

Consequências:
- chave nova listada num plano em `plans-complete.ts` entra **ligada** no
  próximo deploy;
- tirar uma chave de `plans-complete.ts` **não** a desliga no banco — desligue
  pelo painel;
- `isActive` e selo do plano continuam sendo do painel (aba Disponibilidade).

## Recursos concedidos por assinatura

`subscription_features.grantSource`:

| Valor | Significado |
|---|---|
| nulo | módulo contratado (pago), como antes |
| `PLAN_RETAINED` | mantido quando o recurso saiu do plano sem atingir as assinaturas atuais |
| `COURTESY` | cortesia dada pelo superadmin (Gerenciar contas › Recursos da conta), com motivo e validade opcional |

Recurso concedido não é módulo: complementos não o listam nem o cobram, a
evolução e a transferência de titularidade o levam para a assinatura nova
(a evolução só se o plano novo não o incluir).

## Como adicionar um recurso novo

1. Catálogo: nova entrada em `src/seeds/features-base.ts` (`price: 0`).
2. Regras: a chave em `PLAN_FEATURE_KEYS`, a linha em `FEATURE_ENFORCEMENT` e,
   se houver, a dependência em `FEATURE_DEPENDENCIES`
   (`src/core/plan/plan-feature-rules.ts`). O spec
   `plan-feature-rules.spec.ts` falha se o catálogo e o código divergirem.
3. Bloqueio no servidor: `@UseGuards(FeatureGuard)` + `@RequiresFeature('chave')`
   na rota, ou `planControlService.enforceFeature(companyId, 'chave')` quando o
   recurso é um campo de um formulário comum (verifique só a MUDANÇA, para quem
   já tem o dado continuar editando).
4. Tela: `usePlanFeatures().hasFeature('chave')`, `FeatureGate` na página e,
   no menu, `requiredFeature` em `consts/nav.ts` (app-web).
5. Padrão de fábrica: a chave nos planos certos em `plans-complete.ts`.

## Ordem de deploy

1. Backend (migrations `20260929120000_plan_config_history` e
   `20260929120100_subscription_feature_grant`; o seed cria Setores no Start e
   no Trial na subida).
2. Front (painel, menus, permissões).

O front antigo funciona com o backend novo. O front novo contra o backend
antigo não tem o painel (rotas `plan/config/*` ausentes).
