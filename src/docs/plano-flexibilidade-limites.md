# 🔧 PLANO: Sistema de Limites Flexível

**Problema**: Sistema atual hardcoded em `auth.service.ts` - precisa alterar código toda vez que criar novo limite  
**Solução**: Sistema 100% dinâmico baseado no banco de dados

---

## 📋 **IMPLEMENTAÇÃO PROPOSTA**

### **1. Atualizar PlanControlService**
```typescript
// ANTES (inflexível):
interface CompanyLimits {
  maxUsers: number;
  maxCompanies: number;
  trialDays: number;
}

// DEPOIS (flexível):
interface CompanyLimits {
  [key: string]: number; // Qualquer limite dinâmico
}
```

### **2. Atualizar AuthService**
```typescript
// ANTES (hardcoded):
limits: {
  maxUsers: planInfo.limits.maxUsers,
  maxCompanies: planInfo.limits.maxCompanies,
  trialDays: planInfo.limits.trialDays
}

// DEPOIS (dinâmico):
limits: planInfo.limits // Retorna TODOS os limites automaticamente
```

### **3. Cadastro de Novos Limites**
```sql
-- Exemplo: Adicionar limite de produtos
INSERT INTO limits (id, key, name, description, unit, "createdAt", "updatedAt") 
VALUES (
  gen_random_uuid(),
  'max_products',
  'Máximo de Produtos', 
  'Limite de produtos que podem ser cadastrados',
  'products',
  NOW(),
  NOW()
);

-- Associar ao plano LITE
INSERT INTO plan_limits (id, "planId", "limitId", value, "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  (SELECT id FROM plans WHERE planType = 'LITE'),
  (SELECT id FROM limits WHERE key = 'max_products'),
  100, -- 100 produtos para LITE
  NOW(),
  NOW()
);
```

---

## 🚀 **VANTAGENS DA SOLUÇÃO**

1. **🔄 Zero código alterado** para novos limites
2. **📊 Admin pode cadastrar** limites via interface
3. **🎯 Sistema escalável** para qualquer tipo de limite
4. **📱 Frontend flexível** - recebe todos os limites automaticamente

---

## 🛠️ **IMPLEMENTAÇÃO IMEDIATA**

### **Passo 1**: Atualizar PlanControlService
### **Passo 2**: Atualizar AuthService  
### **Passo 3**: Criar endpoints CRUD para Limits
### **Passo 4**: Testar com novo limite

**Tempo estimado**: 45 minutos