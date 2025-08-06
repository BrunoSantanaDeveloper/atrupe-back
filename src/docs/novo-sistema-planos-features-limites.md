# Novo Sistema de Planos, Features e Limites - Atrupe API

## Visão Geral da Reestruturação

O sistema anterior misturava features (funcionalidades) com limits (quantidades), tratando "user_limit_3" como uma feature quando na verdade é um limite. O novo sistema separa corretamente:

- **Features**: O que o plano pode fazer (CRM, Relatórios Avançados, etc.)
- **Limits**: Quantidades permitidas (máximo de usuários, produtos, etc.)
- **Plans**: Combinam features + limits + preços
- **Subscriptions**: Plano ativo + recursos adicionais contratados

## Estrutura do Banco de Dados

### Novos Models

```prisma
model Feature {
  key                  String                // 'crm', 'advanced_reports'
  name                 String                // 'CRM', 'Relatórios Avançados'
  category             String?               // 'management', 'reports'
  price                Float                 // preço adicional em centavos
}

model Limit {
  key         String      // 'max_users', 'max_quotations_month'
  name        String      // 'Máximo de Usuários'
  unit        String?     // 'users', 'quotations'
}

model PlanFeature {
  planId    String
  featureId String
  // Relaciona quais features cada plano inclui
}

model PlanLimit {
  planId  String
  limitId String
  value   Int      // valor do limite para este plano
  // Define os limites de cada plano
}

model SubscriptionFeature {
  subscriptionId String
  featureId      String
  price          Float    // preço pago por esta feature adicional
  // Features extras contratadas além do plano base
}
```

### Model Plan Atualizado

```prisma
model Plan {
  basePrice             Float         // preço base do plano
  additionalAccessPrice Float         // preço por usuário adicional
  planFeatures          PlanFeature[] // features inclusas
  planLimits            PlanLimit[]   // limites do plano
}
```

### Model Subscription Atualizado

```prisma
model Subscription {
  additionalUsers        Int                    // usuários extras contratados
  subscriptionFeatures   SubscriptionFeature[]  // features extras contratadas
}
```

## Configuração dos Planos

### Features Disponíveis

```typescript
// src/seeds/features-base.ts
export const BASE_FEATURES = [
  // Features básicas (grátis)
  { key: 'basic_management', name: 'Gestão Básica', price: 0 },
  { key: 'basic_financial', name: 'Financeiro Básico', price: 0 },
  { key: 'basic_quotations', name: 'Orçamentos Básicos', price: 0 },

  // Features premium (controle binário: tem acesso ou não tem)
  { key: 'crm', name: 'CRM Completo', price: 5000 }, // R$ 50,00
  { key: 'advanced_reports', name: 'Relatórios Avançados', price: 7500 }, // R$ 75,00
  { key: 'production_manager', name: 'Gerenciador de Produção', price: 10000 }, // R$ 100,00
  { key: 'inventory_management', name: 'Gestão de Estoque', price: 12500 }, // R$ 125,00
  { key: 'advanced_financial', name: 'Financeiro Avançado', price: 3000 }, // R$ 30,00
  { key: 'multi_company', name: 'Multi-Empresas', price: 15000 }, // R$ 150,00
];
```

### Limites Disponíveis

```typescript
// src/seeds/limits-base.ts
export const BASE_LIMITS = [
  { key: 'max_users', name: 'Máximo de Usuários', unit: 'users' },
  {
    key: 'max_quotations_month',
    name: 'Máximo de Orçamentos por Mês',
    unit: 'quotations',
  },
  { key: 'max_products', name: 'Máximo de Produtos', unit: 'products' },
  { key: 'max_clients', name: 'Máximo de Clientes', unit: 'clients' },
  { key: 'max_storage_mb', name: 'Armazenamento', unit: 'mb' },
];
```

### Configuração dos Planos

```typescript
// src/seeds/plans-complete.ts
export const PLAN_CONFIGURATIONS = {
  TRIAL: {
    plan: {
      basePrice: 0,
      additionalAccessPrice: 0,
    },
    features: ['basic_management', 'basic_financial', 'basic_quotations'],
    limits: {
      max_users: 3,
      max_quotations_month: 50,
      max_products: 100,
      max_storage_mb: 100,
    },
  },

  LITE: {
    plan: {
      basePrice: 23000, // R$ 230,00
      additionalAccessPrice: 2000, // R$ 20,00
    },
    features: [
      'basic_management',
      'basic_financial',
      'basic_quotations',
      'crm',
    ],
    limits: {
      max_users: 5,
      max_quotations_month: 500,
      max_products: 1000,
      max_storage_mb: 1000,
    },
  },

  FULL: {
    features: [
      'basic_management',
      'crm',
      'advanced_reports',
      'inventory_management',
    ],
    limits: {
      max_users: -1, // ilimitado
      max_quotations_month: -1, // ilimitado
      max_storage_mb: 10000,
    },
  },
};
```

## Como Usar

### 1. Controle Binário de Features (Frontend)

O sistema foi projetado para controle binário simples: **tem acesso ou não tem acesso**.

```typescript
// No frontend, você pode verificar se uma feature está disponível
const userFeatures = user.company.features; // ['basic_management', 'crm', 'advanced_reports']

// Controle de exibição de componentes
const canShowCRM = userFeatures.includes('crm');
const canShowAdvancedReports = userFeatures.includes('advanced_reports');

// Exemplo React:
{canShowCRM && <CRMDashboard />}
{canShowAdvancedReports && <AdvancedReportsButton />}
{!canShowAdvancedReports && <UpgradePlanButton />}
```

**Características do Controle Binário:**
- ✅ **Simples**: Feature está presente = pode acessar
- ✅ **Claro**: Não há níveis ou variações dentro da feature  
- ✅ **Rápido**: Verificação instantânea no frontend
- ✅ **Escalável**: Fácil adicionar novas features

### 2. Populando o Banco

```bash
# Executar migração do Prisma
npx prisma migrate dev

# Executar seed
npx ts-node src/scripts/migrate-and-seed-plans.ts
```

### 3. Usando Guards e Decorators (Backend)

```typescript
import { RequiresFeature } from '../core/plan/decorators/requires-feature.decorator';
import { RequiresLimit } from '../core/plan/decorators/requires-limit.decorator';
import { FeatureGuard, LimitGuard } from '../core/plan/guards';

@Controller('reports')
export class ReportsController {
  
  // Endpoint básico - sem restrições
  @Get('/basic')
  async getBasicReport() {
    return { message: 'Basic report data' };
  }

  // Endpoint que requer feature CRM (acesso binário: tem ou não tem)
  @Get('/crm-dashboard')
  @UseGuards(FeatureGuard)
  @RequiresFeature('crm')
  async getCrmReport() {
    return { message: 'CRM report data' };
  }

  // Endpoint que requer feature de relatórios avançados
  @Get('/advanced')
  @UseGuards(FeatureGuard)
  @RequiresFeature('advanced_reports')
  async getAdvancedReport() {
    return { message: 'Advanced report data' };
  }

  // Verifica limite antes de criar
  @Post('/custom-report')
  @UseGuards(LimitGuard)
  @RequiresLimit('max_quotations_month', 'create')
  async createCustomReport() {
    return { message: 'Custom report created' };
  }
}
```

### 3. Usando o PlanControlService

```typescript
export class MyService {
  constructor(private planControlService: PlanControlService) {}

  async createUser(companyId: string) {
    // Verificar se tem limite de usuários
    const currentUsers =
      await this.planControlService.getCurrentUserCount(companyId);
    await this.planControlService.enforceLimit(
      companyId,
      'max_users',
      currentUsers + 1,
    );

    // Verificar se tem feature específica
    await this.planControlService.enforceFeature(companyId, 'crm');

    // Criar usuário...
  }

  async getCompanyInfo(companyId: string) {
    const planInfo =
      await this.planControlService.getCompanyPlanInfo(companyId);

    return {
      planName: planInfo.planName,
      features: planInfo.features,
      limits: planInfo.limits,
      isTrialActive: planInfo.isTrialActive,
    };
  }
}
```

### 4. Criando Subscription com Recursos Adicionais

```typescript
// Criar subscription com usuários e features extras
const subscription = await subscriptionService.create(
  {
    planId: 'lite-plan-id',
    additionalUsers: 5, // +5 usuários além dos 5 do plano LITE = 10 total
    additionalFeatures: ['advanced_reports'], // adicionar relatórios avançados
    billingType: 'CREDIT_CARD',
    cycle: 'MONTHLY',
  },
  request,
);

// Cálculo automático do preço:
// R$ 230,00 (base LITE) + R$ 100,00 (5 × R$ 20,00 usuários) + R$ 75,00 (relatórios) = R$ 405,00
```

## Benefícios da Nova Estrutura

### ✅ Separação Clara de Conceitos

- **Features**: Funcionalidades (o que pode fazer)
- **Limits**: Quantidades (quanto pode fazer)

### ✅ Flexibilidade Total

- Planos podem ter qualquer combinação de features e limits
- Subscriptions podem adicionar features e usuários extras
- Fácil criação de novos planos sem código

### ✅ Controle Granular

- Guards automáticos verificam features e limites
- Enforcement programático via service
- Mensagens de erro personalizadas

### ✅ Escalabilidade

- Sistema preparado para crescimento
- Fácil adição de novas features e limites
- Suporte a recursos adicionais na subscription

### ✅ Auditoria e Transparência

- Histórico completo de features e limites por subscription
- Preços individualizados por recurso adicional
- Fácil geração de relatórios de uso

## Migração do Sistema Antigo

### Mapeamento de Features Antigas → Novas

```typescript
// Sistema antigo → Sistema novo
'user_limit_3'           → limit: { max_users: 3 }
'user_limit_5'           → limit: { max_users: 5 }
'sales_orders_full'      → feature: 'basic_quotations' + limit: { max_quotations_month: -1 }
'sales_orders_limited'   → feature: 'basic_quotations' + limit: { max_quotations_month: 200 }
'crm_full'              → feature: 'crm'
'advanced_reports'      → feature: 'advanced_reports'
```

### Passos da Migração

1. ✅ **Schema atualizado** - Novos models criados
2. ✅ **Seeds criados** - Features, Limits e Plans definidos
3. ✅ **Services implementados** - PlanControlService funcional
4. ✅ **Guards criados** - Validação automática
5. ✅ **Subscription Service atualizado** - Suporte a recursos adicionais
6. ✅ **Auth Service atualizado** - Integração com novo sistema
7. 🔄 **Migração de dados** - Converter subscriptions existentes
8. 🔄 **Testes** - Validar todo o fluxo
9. 🔄 **Frontend** - Atualizar para nova estrutura

## Próximos Passos

1. **Migrar dados existentes**: Converter subscriptions atuais para nova estrutura
2. **Implementar nos controllers**: Adicionar guards nos endpoints críticos
3. **Atualizar frontend**: Consumir nova estrutura de features e limites
4. **Testes**: Criar testes unitários e de integração
5. **Documentação API**: Atualizar Swagger com novos endpoints

---

_Sistema implementado em: 2025-08-05_
