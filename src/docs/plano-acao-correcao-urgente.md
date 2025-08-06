# 🚨 PLANO DE AÇÃO - CORREÇÃO URGENTE DO SISTEMA

**Status**: 🔴 **CRÍTICO** - Sistema retornando dados incorretos  
**Data**: Agosto 2025  
**Problema**: Login retorna informações inconsistentes com o sistema implementado

---

## 📋 **PROBLEMAS IDENTIFICADOS**

### 1. **🔴 Subscription Type Inconsistente**
- **Retornado**: `"subscription": "LITE"`
- **Real no banco**: Subscription TRIAL criada hoje
- **Impacto**: Sistema usando dados incorretos

### 2. **🔴 Features Incorretas**
- **Retornado**: Apenas 3 features básicas
  ```json
  "features": [
    "basic_management",
    "basic_quotations", 
    "basic_service_orders"
  ]
  ```
- **Esperado LITE**: 26 features (básicas + específicas do LITE)
- **Problema**: Sistema não está usando o novo modelo Feature/Limit

### 3. **🔴 Limites Ausentes**
- **Retornado**: Nenhum limite (`max_users`, `max_companies`, etc.)
- **Esperado**: Informações de limites baseadas no plano
- **Impacto**: Guards de limite não funcionarão

### 4. **🔴 Trial Date Inconsistente**
- **Retornado**: `"trialEndsAt": "2025-06-30T18:03:45.837Z"` (junho)
- **Real**: Subscription TRIAL criada hoje com término em 13/08/2025
- **Problema**: Dados desatualizados

---

## 🎯 **PLANO DE AÇÃO DETALHADO**

### **FASE 1: DIAGNÓSTICO COMPLETO** ⏱️ 30min

#### **1.1 - Investigar AuthService.getPlanFeatures()**
```typescript
// Arquivo: src/core/auth/auth.service.ts
// Verificar como está obtendo as features
```

#### **1.2 - Verificar Subscription Real no Banco**
```sql
SELECT s.*, p.name, p.planType 
FROM subscriptions s 
JOIN plans p ON s."planId" = p.id 
WHERE s."companyId" = '69dca199-98bb-46cc-84e6-9872af2c282f';
```

#### **1.3 - Verificar Features do Plano**
```sql
SELECT p.name, p.planType, f.key, f.name as feature_name
FROM plans p
JOIN plan_features pf ON p.id = pf."planId"
JOIN features f ON pf."featureId" = f.id
WHERE p.id = (SELECT "planId" FROM subscriptions WHERE "companyId" = '69dca199-98bb-46cc-84e6-9872af2c282f' AND status = 'ACTIVE');
```

#### **1.4 - Verificar se PlanControlService está sendo usado**
- Verificar se AuthService está chamando o novo `PlanControlService`
- Ou se ainda está usando lógica antiga

---

### **FASE 2: CORREÇÃO DA SUBSCRIPTION** ⏱️ 15min

#### **2.1 - Atualizar Subscription para LITE**
A empresa Tesla deveria estar no plano LITE, não TRIAL.

```sql
-- Atualizar para plano LITE
UPDATE subscriptions 
SET "planId" = (SELECT id FROM plans WHERE planType = 'LITE' LIMIT 1)
WHERE "companyId" = '69dca199-98bb-46cc-84e6-9872af2c282f';
```

#### **2.2 - Corrigir Trial Date**
```sql
-- Ajustar ou remover trialEndsAt se não for mais trial
UPDATE companies 
SET "trialEndsAt" = NULL 
WHERE id = '69dca199-98bb-46cc-84e6-9872af2c282f';
```

---

### **FASE 3: CORREÇÃO DO AUTHSERVICE** ⏱️ 45min

#### **3.1 - Verificar AuthService.getPlanFeatures()**
Precisa usar o novo `PlanControlService.getCompanyPlanInfo()`:

```typescript
// ❌ REMOVER lógica antiga
// ✅ USAR:
const planInfo = await this.planControlService.getCompanyPlanInfo(companyId);
return {
  subscription: planInfo.planType,
  features: Object.keys(planInfo.features), // Array de feature keys
  limits: planInfo.limits, // { maxUsers, maxCompanies, trialDays }
  trialActive: planInfo.isTrialActive,
  trialEndsAt: planInfo.trialEndsAt
};
```

#### **3.2 - Atualizar Response do Login**
Incluir informações de limites:

```typescript
company: {
  // ... outros campos
  subscription: planInfo.planType, // 'LITE'
  features: Object.keys(planInfo.features), // 26 features
  limits: {
    maxUsers: planInfo.limits.maxUsers, // 5
    maxCompanies: planInfo.limits.maxCompanies, // 1
    trialDays: planInfo.limits.trialDays // 0
  },
  trialEndsAt: planInfo.trialEndsAt
}
```

---

### **FASE 4: VALIDAÇÃO E TESTES** ⏱️ 30min

#### **4.1 - Testar PlanControlService Diretamente**
```typescript
// Console test
const planInfo = await planControlService.getCompanyPlanInfo('69dca199-98bb-46cc-84e6-9872af2c282f');
console.log(planInfo);
```

#### **4.2 - Testar Login Atualizado**
- Fazer login e verificar response
- Confirmar 26 features para LITE
- Confirmar limites corretos

#### **4.3 - Testar Guards**
```typescript
// Testar endpoint com feature específica do LITE
@RequiresFeature('sectors_configuration')
```

---

## 🔧 **COMANDOS RÁPIDOS PARA DIAGNÓSTICO**

### **1. Verificar Subscription Atual**
```bash
npx prisma db execute --stdin <<< "SELECT s.*, p.name, p.planType FROM subscriptions s JOIN plans p ON s.\"planId\" = p.id WHERE s.\"companyId\" = '69dca199-98bb-46cc-84e6-9872af2c282f';"
```

### **2. Verificar Features do Plano**
```bash
npx ts-node -e "
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
(async () => {
  const sub = await prisma.subscription.findFirst({
    where: { companyId: '69dca199-98bb-46cc-84e6-9872af2c282f', status: 'ACTIVE' },
    include: { plan: { include: { planFeatures: { include: { feature: true } } } } }
  });
  console.log('Plano:', sub?.plan.planType);
  console.log('Features:', sub?.plan.planFeatures.length);
  await prisma.\$disconnect();
})();
"
```

---

## 📊 **RESULTADO ESPERADO APÓS CORREÇÃO**

```json
{
  "company": {
    "subscription": "LITE",
    "features": [
      "basic_management",
      "basic_quotations", 
      "basic_service_orders",
      "sectors_configuration",
      "quotation_quick_sale",
      "accounts_receivable",
      // ... todas as 26 features do LITE
    ],
    "limits": {
      "maxUsers": 5,
      "maxCompanies": 1,
      "trialDays": 0
    },
    "trialEndsAt": null
  }
}
```

---

## ⚡ **PRIORIDADES DE EXECUÇÃO**

| Fase | Descrição | Tempo | Prioridade |
|------|-----------|-------|------------|
| 1 | **Diagnóstico AuthService** | 30min | 🔴 Crítica |
| 2 | **Correção Subscription** | 15min | 🔴 Crítica |
| 3 | **Correção AuthService** | 45min | 🟡 Alta |
| 4 | **Validação e Testes** | 30min | 🟢 Média |

**Total estimado**: 2 horas

---

## 🎯 **PRÓXIMO PASSO IMEDIATO**

**COMEÇAR COM**: Diagnóstico do AuthService para entender por que não está usando o novo sistema.

```bash
# 1. Primeiro, verificar subscription real
npx prisma db execute --stdin <<< "SELECT s.*, p.planType FROM subscriptions s JOIN plans p ON s.\"planId\" = p.id WHERE s.\"companyId\" = '69dca199-98bb-46cc-84e6-9872af2c282f';"

# 2. Depois, analisar AuthService.getPlanFeatures()
```