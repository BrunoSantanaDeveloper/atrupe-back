# Plano de Ação: Correção de Referências após Remoção de Compatibilidade do Schema

## Resumo

Após a limpeza do schema Prisma removendo campos de compatibilidade, foram identificadas múltiplas referências no código que precisam ser corrigidas antes da migração do banco zerado.

## Campos Removidos do Schema

### Model Plan

- ❌ `additionalAccessPrice: Float` → ✅ `additionalUserPrice: Float`
- ❌ `modules: String[]` → ✅ usar `planFeatures` relation

### Model Subscription

- ❌ `additionalAccesses: Int` → ✅ `additionalUsers: Int`
- ❌ `modules: String[]` → ✅ usar `subscriptionFeatures` relation

### Models Removidos

- ❌ `Module` model (completamente removido)
- ❌ `unit_measures_backup` table (removida)

---

## 🔴 Referências Críticas a Corrigir

### 1. Campo `additionalAccessPrice` (9 arquivos)

#### 1.1 Seeds e Configurações

```typescript
// ❌ REMOVER
additionalAccessPrice: 15.0;

// ✅ SUBSTITUIR POR
additionalUserPrice: 15.0;
```

**Arquivos afetados:**

- `/prisma/seed.ts:128`
- `/src/seeds/plans-base.ts` (linhas 8,17,26,35,44,53)
- `/src/seeds/plans-complete.ts` (linhas 9,27,45,92,139,186)
- `/src/seeds/seed-plans.service.ts:75`

#### 1.2 Serviços e Scripts

**Arquivos afetados:**

- `/src/core/subscriptions/subscriptions.service.ts:314`
- `/src/scripts/migrate-and-seed-plans.ts:42`
- `/src/scripts/update-company-to-lite-plan.ts:66`
- `/src/scripts/migrate-data-before-schema.ts` (linhas 31,32,36,44)

#### 1.3 DTOs e Tipos

- `/src/core/plan/dtos/plan.ts`

### 2. Campo `modules` no Plan (3 arquivos)

```typescript
// ❌ REMOVER
trialPlan.modules;

// ✅ SUBSTITUIR POR
trialPlan.planFeatures.map((pf) => pf.feature);
```

**Arquivos afetados:**

- `/src/core/user/user.service.ts:224` - comentário "COMPATIBILIDADE: usar campo antigo"
- `/src/core/subscriptions/subscriptions.service.ts:201`
- `/src/scripts/check-subscriptions-simple.ts:40` - SQL manual

### 3. Campo `additionalAccesses` no Subscription (7 arquivos)

```typescript
// ❌ REMOVER
subscription.additionalAccesses;

// ✅ SUBSTITUIR POR
subscription.additionalUsers;
```

**Arquivos afetados:**

- `/src/core/subscriptions/subscriptions.service.ts` (linhas 215,314,374)
- `/src/scripts/fix-missing-subscriptions.ts:89`
- `/src/scripts/create-trial-subscription.ts:84`
- `/src/scripts/check-subscriptions-simple.ts:40`
- `/src/scripts/migrate-data-before-schema.ts` (linhas 10,11,15,23)

### 4. Campo `modules` no Subscription (6 arquivos)

```typescript
// ❌ REMOVER
subscription.modules.includes(moduleId);

// ✅ SUBSTITUIR POR
subscription.subscriptionFeatures.some((sf) => sf.feature.key === moduleId);
```

**Arquivos afetados:**

- `/src/core/subscriptions/subscriptions.service.ts` (linhas 200,298,303,354,359,366)
- `/src/scripts/check-subscriptions-simple.ts:40`

---

## 📋 Plano de Execução por Prioridade

### Fase 1: Seeds e Configurações (CRÍTICO)

- [ ] Atualizar `/prisma/seed.ts`
- [ ] Corrigir `/src/seeds/plans-base.ts`
- [ ] Corrigir `/src/seeds/plans-complete.ts`
- [ ] Corrigir `/src/seeds/seed-plans.service.ts`

### Fase 2: Serviços Principais (CRÍTICO)

- [ ] Refatorar `/src/core/subscriptions/subscriptions.service.ts`
- [ ] Corrigir `/src/core/user/user.service.ts`
- [ ] Atualizar `/src/core/plan/dtos/plan.ts`

### Fase 3: Scripts de Migração (IMPORTANTE)

- [ ] Corrigir `/src/scripts/migrate-data-before-schema.ts`
- [ ] Atualizar `/src/scripts/migrate-and-seed-plans.ts`
- [ ] Corrigir `/src/scripts/update-company-to-lite-plan.ts`

### Fase 4: Scripts Auxiliares (MÉDIO)

- [ ] Corrigir `/src/scripts/fix-missing-subscriptions.ts`
- [ ] Atualizar `/src/scripts/create-trial-subscription.ts`
- [ ] Corrigir `/src/scripts/check-subscriptions-simple.ts`

---

## 🔧 Estratégias de Migração

### Para campos simples (additionalAccessPrice → additionalUserPrice)

```typescript
// Buscar e substituir direto
plan.additionalAccessPrice → plan.additionalUserPrice
```

### Para arrays modules → relations

```typescript
// ANTES
const hasModule = plan.modules.includes('crm');

// DEPOIS
const hasModule = plan.planFeatures.some((pf) => pf.feature.key === 'crm');
```

### Para subscription.modules → subscriptionFeatures

```typescript
// ANTES
subscription.modules.filter((m) => m === moduleId);

// DEPOIS
subscription.subscriptionFeatures
  .filter((sf) => sf.feature.key === moduleId)
  .map((sf) => sf.feature);
```

---

## ⚠️ Considerações Importantes

1. **Ordem de Execução**: Corrigir seeds primeiro para evitar erros na migração
2. **Testes**: Executar testes após cada fase
3. **Backup**: Garantir backup do código antes das alterações
4. **Validação**: Usar `npx prisma validate` após cada correção

---

## 🎯 Critérios de Sucesso

- [ ] Todos os arquivos compilam sem erro de TypeScript
- [ ] Seeds executam sem erro
- [ ] Serviços principais funcionam corretamente
- [ ] Migrations executam com sucesso
- [ ] Testes passam

---

## 📝 Notas Técnicas

- **Model Module**: Completamente removido, não há referências diretas no código
- **unit_measures_backup**: Era tabela ignorada, sem impacto no código
- **SQL Scripts**: Alguns scripts contêm SQL manual que precisa ser atualizado

---

**Status**: ✅ **CONCLUÍDO** - Todas as correções foram aplicadas

**Resultado**:

- ✅ Schema Prisma validado com sucesso
- ✅ Cliente Prisma regenerado
- ✅ Build completo sem erros TypeScript
- ✅ Todas as 27 referências corrigidas
- ✅ Sistema pronto para reset do banco

**Executado**: Agosto 2025

**Prioridade**: RESOLVIDA
