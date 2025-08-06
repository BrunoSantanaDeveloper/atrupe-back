# 🔧 Ajustes Temporários - Migração Feature/Limit System

**Status**: 📋 Documento de Correções Pendentes  
**Data**: Janeiro 2025  
**Objetivo**: Guiar a migração completa do sistema antigo (modules) para o novo (features/limits)

---

## 📋 Situação Atual

### ✅ **Migração Realizada COM SUCESSO**
- ✅ Banco de dados migrado **SEM PERDA DE DADOS**
- ✅ Novas tabelas criadas: `features`, `limits`, `plan_features`, `plan_limits`, `subscription_features`
- ✅ Sistema compilando e funcionando
- ✅ Campos antigos mantidos para compatibilidade

### 🔄 **Ajustes Temporários Implementados**

Para evitar perda de dados e manter o sistema funcionando, foram feitos ajustes de **compatibilidade temporária**:

---

## 🏗️ **AJUSTES TEMPORÁRIOS IMPLEMENTADOS**

### 1. **Schema Prisma - Campos de Compatibilidade**

**Arquivo**: `prisma/schema.prisma`

```prisma
model Plan {
  // Campos antigos (manter por compatibilidade)
  additionalAccessPrice Float
  modules               String[]       @default([]) // DEPRECATED: usar planFeatures
  
  // Novos campos
  additionalUserPrice   Float?         @default(0) // Nova nomenclatura
  
  // Novos relacionamentos
  planFeatures          PlanFeature[]
  planLimits            PlanLimit[]
}

model Subscription {
  // Campos antigos (manter por compatibilidade)
  additionalAccesses   Int?                  @default(0) // DEPRECATED: usar additionalUsers
  modules              String[]       @default([]) // DEPRECATED: usar subscriptionFeatures
  
  // Novos campos
  additionalUsers      Int                   @default(0) // usuários adicionais contratados
  
  // Novos relacionamentos
  subscriptionFeatures SubscriptionFeature[] // features adicionais contratadas
}

// DEPRECATED: Tabela antiga - manter apenas para preservar dados existentes
model Module {
  // ... campos originais mantidos
  @@ignore // Ignorar no Prisma Client
  @@map("modules")
}
```

**❌ PROBLEMA**: Duplicação de campos e lógica  
**🎯 SOLUÇÃO**: [Ver seção de correção](#correcao-schema)

---

### 2. **SubscriptionsService - Lógica Temporária**

**Arquivo**: `src/core/subscriptions/subscriptions.service.ts`

**Problemas implementados temporariamente:**

```typescript
// ❌ TEMPORÁRIO: Usar sistema antigo de pricing
const featuresValue = 0; // Por enquanto, sem custo extra de features

// ❌ TEMPORÁRIO: Usar campos antigos
const currentModules = currentSubscription.modules || [];
const newPlanModules = newPlan.modules || [];

// ❌ TEMPORÁRIO: Usar additionalAccessPrice ao invés de additionalUserPrice
newPlan.additionalAccessPrice * (currentSubscription.additionalAccesses || 0);

// ❌ TEMPORÁRIO: Usar modules ao invés de subscriptionFeatures
modules: combinedModules, // COMPATIBILIDADE: usar campo antigo
```

**❌ PROBLEMA**: Sistema não está usando as novas features  
**🎯 SOLUÇÃO**: [Ver seção de correção](#correcao-subscriptions-service)

---

### 3. **UserService - Lógica Temporária**

**Arquivo**: `src/core/user/user.service.ts`

```typescript
// ❌ TEMPORÁRIO: Usar campo antigo
modules: trialPlan.modules, // COMPATIBILIDADE: usar campo antigo
```

**❌ PROBLEMA**: Criação de trial não usa sistema novo  
**🎯 SOLUÇÃO**: [Ver seção de correção](#correcao-user-service)

---

### 4. **Seed System - Desabilitado Temporariamente**

**Arquivo**: `prisma/seed.ts`

```typescript
// ❌ TEMPORÁRIO: Pular o seeding das novas tabelas por enquanto
console.log('Pulando seeding do novo sistema por enquanto - usar migração manual');
// TODO: Implementar seeding manual ou ajustar SeedPlansService para PrismaClient
```

**❌ PROBLEMA**: Tabelas novas estão vazias  
**🎯 SOLUÇÃO**: [Ver seção de correção](#correcao-seeding)

---

## 🎯 **COMO CORRIGIR - ROADMAP DE MIGRAÇÃO**

### <a name="correcao-seeding"></a>**PASSO 1: Popular Tabelas Features/Limits**

**Prioridade**: 🔴 **CRÍTICA** - Sem isso, o novo sistema não funciona

```bash
# 1. Executar script de migração que criamos
npx ts-node src/scripts/migrate-and-seed-plans.ts
```

**Ou alternativamente:**

```typescript
// Criar endpoint temporário no controller para popular
@Post('migrate-to-new-system')
async migrateToNewSystem() {
  const seedService = new SeedPlansService(this.prisma);
  return await seedService.seedAll();
}
```

**Resultado esperado**: Tabelas `features` e `limits` populadas com 24 features e 3 limits

---

### <a name="correcao-subscriptions-service"></a>**PASSO 2: Corrigir SubscriptionsService**

**Arquivo**: `src/core/subscriptions/subscriptions.service.ts`

#### **2.1 - Corrigir cálculo de features**

```typescript
// ❌ REMOVER:
const featuresValue = 0; // Por enquanto, sem custo extra

// ✅ IMPLEMENTAR:
const additionalFeaturesValue = additionalFeatures.reduce(
  (acc, feature) => acc + feature.price,
  0,
);
```

#### **2.2 - Corrigir busca de features**

```typescript
// ❌ REMOVER:
const currentModules = currentSubscription.modules || [];

// ✅ IMPLEMENTAR:
const currentSubscription = await this.prisma.subscription.findUnique({
  where: { id: subscriptionId },
  include: {
    subscriptionFeatures: {
      include: { feature: true }
    }
  }
});
const currentFeatures = currentSubscription.subscriptionFeatures.map(sf => sf.feature);
```

#### **2.3 - Corrigir atualização de subscription**

```typescript
// ❌ REMOVER:
modules: combinedModules,

// ✅ IMPLEMENTAR:
subscriptionFeatures: {
  create: newFeatures.map(featureId => ({
    featureId,
    isActive: true
  }))
}
```

#### **2.4 - Corrigir uso de additionalUsers**

```typescript
// ❌ REMOVER:
plan.additionalAccessPrice * (subscription.additionalAccesses || 0);

// ✅ IMPLEMENTAR:
plan.additionalUserPrice * subscription.additionalUsers;
```

---

### <a name="correcao-user-service"></a>**PASSO 3: Corrigir UserService**

**Arquivo**: `src/core/user/user.service.ts`

```typescript
// ❌ REMOVER:
modules: trialPlan.modules,

// ✅ IMPLEMENTAR:
// Usar o novo PlanControlService para verificar features do TRIAL
const planInfo = await this.planControlService.getCompanyPlanInfo(companyId);
// Subscription será criada automaticamente com as features do plano
```

---

### <a name="correcao-schema"></a>**PASSO 4: Limpar Schema (APÓS migração completa)**

**⚠️ ATENÇÃO**: Fazer isso apenas DEPOIS de migrar todos os dados

```prisma
model Plan {
  id                    String         @id @default(uuid())
  // ... outros campos
  
  // ❌ REMOVER (após migração completa):
  // additionalAccessPrice Float
  // modules               String[]
  
  // ✅ MANTER:
  additionalUserPrice   Float          @default(0)
  planFeatures          PlanFeature[]
  planLimits            PlanLimit[]
}

model Subscription {
  id                   String                @id @default(uuid())
  // ... outros campos
  
  // ❌ REMOVER (após migração completa):
  // additionalAccesses   Int?
  // modules              String[]
  
  // ✅ MANTER:
  additionalUsers      Int                   @default(0)
  subscriptionFeatures SubscriptionFeature[]
}

// ❌ REMOVER completamente (após migração):
// model Module { ... }
```

---

## 📋 **CHECKLIST DE MIGRAÇÃO**

### **Fase 1: Preparação** 
- [x] ✅ Novas tabelas criadas
- [x] ✅ Dados antigos preservados
- [x] ✅ Sistema compilando
- [ ] ⏳ Tabelas Features/Limits populadas

### **Fase 2: Implementação**
- [ ] ⏳ SubscriptionsService usando novo sistema
- [ ] ⏳ UserService usando novo sistema  
- [ ] ⏳ Endpoints testados com novo sistema
- [ ] ⏳ Frontend atualizado para usar novas features

### **Fase 3: Validação**
- [ ] ⏳ Testes unitários passando
- [ ] ⏳ Testes de integração passando
- [ ] ⏳ Validação em ambiente de staging
- [ ] ⏳ Migração de dados existentes

### **Fase 4: Finalização**
- [ ] ⏳ Campos deprecated removidos
- [ ] ⏳ Tabela Module removida
- [ ] ⏳ Documentação atualizada
- [ ] ⏳ Deploy em produção

---

## 🔗 **Scripts Úteis para Migração**

### **Popular Features e Limits**
```bash
npx ts-node src/scripts/migrate-and-seed-plans.ts
```

### **Migrar dados existentes**
```typescript
// Criar script para migrar subscriptions antigas
// src/scripts/migrate-existing-subscriptions.ts
import { PrismaClient } from '@prisma/client';

async function migrateExistingSubscriptions() {
  const prisma = new PrismaClient();
  
  // Buscar todas as subscriptions com modules
  const subscriptions = await prisma.subscription.findMany({
    where: { modules: { not: { equals: [] } } }
  });
  
  for (const sub of subscriptions) {
    // Migrar modules para subscriptionFeatures
    // ... lógica de migração
  }
}
```

### **Testar novo sistema**
```bash
# Testar endpoints
curl http://localhost:3000/api/plan
curl http://localhost:3000/api/subscriptions

# Testar guards
# (endpoints protegidos com @RequiresFeature)
```

---

## ⚠️ **CUIDADOS IMPORTANTES**

1. **🚨 Não deletar dados antigos** até a migração completa
2. **🚨 Testar em staging** antes de produção  
3. **🚨 Fazer backup** antes de cada passo
4. **🚨 Validar** que o sistema antigo ainda funciona durante a transição
5. **🚨 Monitorar** logs durante a migração

---

## 📊 **Status de Migração Atual**

| Componente | Status | Prioridade | Estimativa |
|------------|--------|------------|------------|
| 🗄️ **Database Schema** | ✅ Completo | - | - |
| 📊 **Seeding Features/Limits** | ⏳ Pendente | 🔴 Crítica | 30 min |
| 🔧 **SubscriptionsService** | ⏳ Pendente | 🔴 Crítica | 2h |
| 👤 **UserService** | ⏳ Pendente | 🟡 Média | 30 min |
| 🧪 **Testes** | ⏳ Pendente | 🟡 Média | 1h |
| 🧹 **Limpeza Schema** | ⏳ Pendente | 🟢 Baixa | 30 min |

**Total estimado**: ~4 horas de desenvolvimento

---

## 🎯 **Resultado Final Esperado**

Após completar todas as correções:

```typescript
// ✅ Sistema funcionando assim:

// Frontend
const features = ['sectors_configuration', 'quotation_quick_sale', 'accounts_receivable'];
const canConfigureSectors = features.includes('sectors_configuration');

// Backend  
@Get('/sectors/configuration')
@UseGuards(FeatureGuard)
@RequiresFeature('sectors_configuration')
async getSectorsConfig() {
  return this.sectorsService.getConfiguration();
}

// Limits
@Post('/users')
@UseGuards(LimitGuard)  
@RequiresLimit({ key: 'max_users', action: 'create' })
async createUser() {
  return this.userService.create();
}
```

---

**📞 Dúvidas?** Este documento deve ser atualizado conforme a migração avança.

**🎯 Próximo passo sugerido**: Executar o seeding das Features/Limits para começar os testes.