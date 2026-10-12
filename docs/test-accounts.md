# Contas de teste por plano

Uma conta por plano (TRIAL, START, LITE, PRO, ELITE, FULL) e por família, em
homolog, criada e mantida por um script idempotente:
`src/scripts/test-accounts/seed-test-accounts.ts` (compilado em
`dist/src/scripts/test-accounts/seed-test-accounts.js`).

- **`demo-<plano>`**: para o Maicol aprovar cada versão (dados curados). A
  automação só faz login nelas.
- **`e2e-<plano>`**: para a automação (smoke e e2e), que grava dados; podem ser
  recarregadas com `--refazer-dados`.

## Guarda tripla

O script cria empresas com assinatura ACTIVE sem cobrança e usuários com
senha conhecida. Por isso só roda com **três** condições, conferidas dentro
dele, antes de qualquer escrita (inclusive no `--dry-run`):

1. `TEST_ACCOUNTS_ENABLED=true` — variável que só o ambiente de homolog define;
2. `APP_ENV` definida e diferente de `production`;
3. Asaas ativo em **sandbox** (`system_settings.asaas_config`, com recaída no
   `ASAAS_TOKEN`; a URL ativa também precisa ser a do sandbox) **e** o banco do
   `DATABASE_URL` com nome diferente do de produção (`atrupeDb`, o padrão do
   backup de produção em `.github/workflows/ci-cd.yml`; homolog é
   `atrupeDbDev`).

Sem as três, o script sai com código 1 dizendo qual guarda falhou, e nada é
gravado. Com o ambiente recusado, nem o código da API é carregado.

## Variáveis

| Variável | Obrigatória | O que é |
|---|---|---|
| `TEST_ACCOUNTS_ENABLED` | sim | `true` só em homolog (guarda 1) |
| `TEST_ACCOUNTS_EMAIL_DOMAIN` | sim | domínio dos e-mails das contas. Use um domínio (ou subdomínio) da Atrupe **sem caixa postal**. O script cria as contas sem a verificação de e-mail; o código de verificação só volta na resposta do cadastro com `APP_ENV` definida e diferente de `production`, para qualquer domínio |
| `TEST_ACCOUNTS_PASSWORD` | sim | senha de todos os usuários das contas (mínimo 8 caracteres). Guarde no cofre da equipe e nos segredos do GitHub; nunca no código, e o script nunca a imprime |

`APP_ENV` e `DATABASE_URL` já existem no ambiente do container.

## Como rodar em homolog

O script vai na imagem (o `npm run build` compila `src/scripts`). No servidor:

```sh
API=$(docker ps -q -f name=atrupe-dev_atrupe | head -1)

# Com as variáveis no .env.dev (valem depois do próximo deploy da stack):
docker exec -i "$API" node dist/src/scripts/test-accounts/seed-test-accounts.js --dry-run
docker exec -i "$API" node dist/src/scripts/test-accounts/seed-test-accounts.js

# Ou só para esta execução, sem pôr a senha na linha de comando
# (`-e VAR` sem valor repassa a variável do shell):
read -rs TEST_ACCOUNTS_PASSWORD && export TEST_ACCOUNTS_PASSWORD
docker exec -i -e TEST_ACCOUNTS_ENABLED=true -e TEST_ACCOUNTS_EMAIL_DOMAIN=<domínio> \
  -e TEST_ACCOUNTS_PASSWORD "$API" \
  node dist/src/scripts/test-accounts/seed-test-accounts.js --garantir
```

`npm run contas-teste` e `npm run contas-teste:dry` fazem o mesmo dentro do
container.

### Opções

| Opção | Efeito |
|---|---|
| `--garantir` (padrão) | cria o que falta e reafirma assinatura, plano, `blockLevel`, cargos e usuários. Não apaga nada e não mexe nos dados que já existem (o que o Maicol alterou fica) |
| `--refazer-dados` | só família **e2e**: aposenta os dados da fixture (orçamentos inativos, clientes e fornecedores `INACTIVE`, com o `legacyId` renomeado para `<chave>~refeito-<data>`) e cria de novo. Nada é apagado: a automação pode ter ligado O.S., financeiro ou itens a eles. Com `--familias demo`, recusa |
| `--planos START,LITE` (ou `--planos=…`) | limita os planos |
| `--familias demo` / `e2e` | limita as famílias |
| `--dry-run` | não grava; relata o que faria. A guarda vale do mesmo jeito |

Código de saída: 0 sem erro; 1 guarda recusada, variável faltando ou erro em
alguma conta (as outras seguem); 2 opção inválida.

A saída termina com uma tabela (família, plano, administrador, situação,
assinatura, usuários, quantidades de dados) e a versão das fixtures, para colar
no roteiro de teste, seguida das mudanças feitas e dos erros.

### Localmente

`npm run contas-teste:dev` / `contas-teste:dry:dev` (ts-node). O
`docker-compose.local.yml` cria o banco com o nome `atrupeDb`, o mesmo de
produção: a guarda recusa. Rode contra um banco com outro nome.

## O que cada conta tem

E-mails: `<cargo>.<família>-<plano>@<TEST_ACCOUNTS_EMAIL_DOMAIN>`, por exemplo
`admin.demo-start@…`, `vendedor.e2e-lite@…`, `caixa.e2e-full@…`. Empresa:
`[TESTE] Comunicação Visual <Plano> (<família>)`.

| Plano | Usuários | Usuários adicionais | `limits.max_users` no login | Chaves próprias do plano (padrão de fábrica) |
|---|---|---|---|---|
| TRIAL | admin, vendedor, producao | 0 | 3 | as do START (a coluna é editável no painel) |
| START | admin, vendedor, producao (3 de 3: o 4º dá 403 `PLAN_LIMIT_REACHED`) | 0 | 3 | `sectors_configuration` |
| LITE | + caixa | 1 | 4 | `accounts_receivable`, `cash_control`, `quotation_quick_sale` e as outras do LITE, `multiple_companies`, `transaction_cancel_reasons` |
| PRO | idem | 1 | 4 | + `cost_base`, `pricing_center` |
| ELITE | idem | 1 | 4 | + `production_manager`, `productivity_tracking` |
| FULL | idem | 1 | 4 | + `stock_control`, `invoice_entry` |

**Assinatura**: `manual_<uuid>` ACTIVE, `billingMode: MANUAL`, no plano global
do `planType`, vencimento um ano à frente (renovado quando faltar menos de 30
dias — no TRIAL é o que mantém o teste "em andamento"). Não depende de o plano
estar ativo nem ter preço, ao contrário do `assign-manual`. O cron de cobrança
pula assinatura `manual_` (`billing-mode.ts`, `subscription-block.service.ts`):
só o superadmin a bloqueia à mão, e o próximo `--garantir` desbloqueia. Outras
assinaturas ACTIVE da empresa são inativadas.

**Cargos e usuários** (`fixtures/roles.ts`):

| Cargo | Usuário | Permissões |
|---|---|---|
| Administrador | titular da conta, cargo `Admin` do primeiro acesso (`isAdmin`) | todas |
| Vendedor | o cargo padrão "Vendedor", com perfil de vendedor fictício (comissão 5%, desconto máximo 10%) | orçamentos (ver, criar, editar, excluir, exportar), O.S. (ver), clientes (ver, criar, editar), dashboards de vendas e orçamentos |
| Produção | cargo "Produção" | O.S. (ver, editar); do LITE para cima, agenda de entrega |
| Caixa (LITE+) | cargo "Caixa" | controle de caixa, fluxo financeiro (ver, editar), orçamentos (ver, criar), clientes (ver) |

Nenhum cargo operacional recebe custo, precificação ou valores (SEG-6). O
`values:values:view` do Vendedor é decisão do PO, e as chaves de caixa e de
produção fecham depois do merge dos catálogos de permissão do fork.

**Dados** (fixtures `v1`, iguais em todas as contas, além dos itens padrão do
cadastro — 16 setores, 25 produtos, séries T1/V1/SL, condições de pagamento,
"Caixa Empresa" com caixa aberto, etc.):

- 8 clientes (4 PF, 4 PJ) e 3 fornecedores, sem CPF/CNPJ, e-mails no domínio
  reservado `.example` e telefones com DDD 00;
- 3 orçamentos em aberto na série V1, pelo serviço de criação de orçamento,
  com o Vendedor como vendedor.

Cada dado leva o `legacyId` `<família>:<tipo>:<ref>` (`e2e:cliente:05`), que é
o que torna o script idempotente; colaboradores dos cargos levam
`<família>:usuario:<cargo>`.

**Ainda não** (TODO nas fixtures de cada plano, para as próximas fatias):
produtos próprios e itens nos orçamentos; orçamentos aprovados, rejeitados e
cancelado e as O.S. que a aprovação cria; no LITE, setores/etapas, status e
motivos em uso, contas bancárias, caixa do dia com movimentos, vendas rápidas,
contas a receber e a pagar, limite de crédito, filial. No PRO, ELITE e FULL, o
que tem dentro das telas novas vem do mock do front até cada módulo ter API;
cada fatia traz a sua fixture, copiada do mock que a rota substitui, e sobe
`FIXTURES_VERSION`.

## O que o `--garantir` reafirma

- empresa ativa e `blockLevel NONE` (sem `blockedAt`/`blockReason`);
- assinatura `manual_` no plano e com os usuários adicionais da fixture;
- permissões dos cargos da fixture (regravadas);
- usuários ativos, no cargo e no perfil da fixture, com a senha de
  `TEST_ACCOUNTS_PASSWORD` — trocar a variável e rodar de novo troca a senha de
  todos. Reativar um usuário respeita o limite do plano, como na tela.

Rodar duas vezes seguidas não grava nada na segunda.

## Smoke por plano

`smoke-test-homolog.ps1`, passos [10] e [11], rodam só com a variável
`SMOKE_PLAN_ACCOUNTS`: um JSON com e-mail e senha do administrador de cada
conta `e2e-<plano>`.

```json
{"START":{"email":"admin.e2e-start@<domínio>","password":"<senha>"},
 "LITE":{"email":"admin.e2e-lite@<domínio>","password":"<senha>"}}
```

- **[10]** faz login em cada conta e confere `company.subscription` (o plano),
  `company.blockLevel` = `NONE`, as chaves-sentinela de
  `scripts/smoke/plan-expectations.json` em `company.features` (as do plano e
  dos anteriores presentes, as do plano seguinte ausentes) e
  `company.limits.max_users` = 3 do plano + usuários adicionais da conta;
- **[11]** chama cada rota de `scripts/smoke/plan-gates.json` com cada conta:
  abaixo do plano mínimo, espera 403 com `userMessage.code`
  `FEATURE_NOT_AVAILABLE` e `userMessage.feature` igual à chave; do plano
  mínimo para cima, 2xx. Só rotas GET sem efeito colateral.

Sem a variável, os dois passos dão SKIP, como os outros; plano que não está no
JSON fica de fora. O login tem limite por IP (10 por minuto): se o smoke tomar
429, espera 61 s e tenta de novo uma vez.

`src/scripts/test-accounts/smoke-matrix.spec.ts` confere os dois JSON contra o
padrão de fábrica (`src/seeds/plans-complete.ts`) e as fixtures: mudar uma
chave de plano no catálogo sem acompanhar o JSON quebra no CI, não no smoke de
homolog. Cada rota nova com gate entra em `plan-gates.json` no mesmo PR (o
filtro de query precisa existir no DTO da rota: parâmetro desconhecido dá 400).
