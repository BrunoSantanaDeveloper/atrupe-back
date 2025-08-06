# Controle de Features e Limites por Plano - Atrupe API

## Sumário

1. [Visão Geral](#visão-geral)
2. [Estrutura de Planos](#estrutura-de-planos)
3. [Sistema de Assinaturas](#sistema-de-assinaturas)
4. [Controle de Features](#controle-de-features)
5. [Sistema de Limites](#sistema-de-limites)
6. [Implementação Atual](#implementação-atual)
7. [Guards e Middleware](#guards-e-middleware)
8. [Arquivos Principais](#arquivos-principais)
9. [Recomendações](#recomendações)

## Visão Geral

O projeto Atrupe API implementa um sistema de controle de features e limites baseado em planos de assinatura. O sistema permite diferentes níveis de acesso e funcionalidades dependendo do plano contratado pela empresa.

### Conceitos Principais

- **Planos**: Diferentes tiers de serviço (TRIAL, START, LITE, PRO, ELITE, FULL)
- **Módulos**: Funcionalidades específicas que podem ser habilitadas por plano
- **Subscriptions**: Assinaturas ativas que vinculam empresas aos planos
- **Features**: Funcionalidades específicas controladas por plano
- **Limites**: Restrições quantitativas por plano (usuários, orçamentos, etc.)

## Estrutura de Planos

### Definição de Planos Base

Localização: `src/seeds/plans-base.ts`

```typescript
export const BASE_PLANS = [
  {
    planType: 'TRIAL',
    name: 'Trial',
    basePrice: 0.0,
    additionalAccessPrice: 0.0,
    modules: ['basic'],
  },
  {
    planType: 'START',
    name: 'Start',
    basePrice: 115.0,
    additionalAccessPrice: 15.0,
    modules: ['basic'],
  },
  {
    planType: 'LITE',
    name: 'Lite',
    basePrice: 230.0,
    additionalAccessPrice: 20.0,
    modules: ['basic', 'crm'],
  },
  // ... outros planos
];
```

### Hierarquia de Planos

1. **TRIAL** (Gratuito - 7 dias)
   - Funcionalidades básicas
   - Até 3 usuários
   - Módulos: [`basic`]

2. **START** (R$ 115,00)
   - Funcionalidades essenciais
   - Até 3 usuários
   - Módulos: [`basic`]

3. **LITE** (R$ 230,00)
   - Inclui CRM
   - Até 5 usuários
   - Módulos: [`basic`, `crm`]

4. **PRO** (R$ 299,90)
   - Relatórios avançados
   - Módulos: [`basic`, `crm`, `advanced_reports`]

5. **ELITE** (R$ 399,90)
   - Gerenciador de produção
   - Módulos: [`basic`, `crm`, `advanced_reports`, `production_manager`]

6. **FULL** (R$ 499,90)
   - Gestão completa de estoque
   - Módulos: [`basic`, `crm`, `advanced_reports`, `production_manager`, `inventory_management`]

### Estrutura no Banco de Dados

```prisma
model Plan {
  id                    String         @id @default(uuid())
  description           String
  name                  String         @unique
  additionalAccessPrice Float
  basePrice             Float
  modules               String[]       // Array de IDs de módulos
  planType              PlanType       @default(START)
  subscriptions         Subscription[]
}

model Subscription {
  id                  String      @id @default(uuid())
  companyId           String?
  additionalAccesses  Int         @default(0)
  modules             String[]    // Módulos ativos na subscription
  planId              String
  value               Float
  status              String      // ACTIVE, EXPIRED, INACTIVE
  billingType         BillingType @default(CREDIT_CARD)
  cycle               Cycle       @default(MONTHLY)
}
```

## Sistema de Assinaturas

### Subscription Service

Localização: `src/core/subscriptions/subscriptions.service.ts`

#### Verificação de Subscription Ativa

```typescript
async findActiveByCompanyId(companyId: string) {
  return this.prisma.subscription.findFirst({
    where: {
      companyId,
      status: 'ACTIVE',
    },
    include: {
      plan: true,
      customer: true,
    },
  });
}
```

#### Criação de Subscription

```typescript
async create(createSubscriptionDto: CreateSubscriptionDto, request) {
  // Verificar se já existe uma subscription ativa para a empresa
  const existingActiveSubscription = await this.prisma.subscription.findFirst({
    where: {
      companyId: request.user.companyId,
      status: 'ACTIVE',
    },
  });

  if (existingActiveSubscription) {
    throw new BadRequestException(
      'Uma subscription ativa já existe para esta empresa.'
    );
  }

  // Calcular valor total baseado no plano e módulos
  const modulesValue = modules.reduce((acc, module) => acc + module.price, 0);
  const value = plan.basePrice + modulesValue + 
    (plan.additionalAccessPrice * createSubscriptionDto.additionalAccesses);
}
```

### Trial Automático

Localização: `src/core/user/user.service.ts:230-275`

```typescript
// Criação automática de trial para novas empresas
const trialPlan = await tx.plan.findFirst({
  where: { planType: 'TRIAL' }
});

if (trialPlan) {
  const trialEndDate = new Date();
  trialEndDate.setDate(trialEndDate.getDate() + 7); // 7 dias de trial

  await tx.subscription.create({
    data: {
      planId: trialPlan.id,
      modules: trialPlan.modules,
      nextDueDate: trialEndDate,
      value: trialPlan.basePrice,
      status: 'ACTIVE',
    },
  });
}
```

## Controle de Features

### Sistema de Features por Plano

Localização: `src/core/auth/auth.service.ts:167-211`

```typescript
private getMockedFeatures(subscriptionType: string): string[] {
  const FEATURES_MAP = {
    LITE: [
      'user_limit_5',
      'additional_cnpj',
      'sectors_management',
      'sales_orders_full',
      'financial_full',
      'crm_full',
    ],
    START: [
      'user_limit_3',
      'sales_orders_limited',
      'rejection_reasons_limited',
      'financial_limited',
      'crm_limited',
    ],
    TRIAL: [
      'user_limit_3',  
      'sales_orders_limited',
      'rejection_reasons_limited',
      'financial_limited',
      'crm_limited',
    ],
  };

  return FEATURES_MAP[subscriptionType] || FEATURES_MAP.START;
}
```

### Features Disponíveis por Plano

#### TRIAL/START
- `user_limit_3`: Máximo 3 usuários
- `sales_orders_limited`: Funcionalidades limitadas de vendas
- `rejection_reasons_limited`: Motivos de rejeição limitados
- `financial_limited`: Controle financeiro básico
- `crm_limited`: CRM com funcionalidades reduzidas

#### LITE e superiores
- `user_limit_5`: Máximo 5 usuários (LITE)
- `sales_orders_full`: Funcionalidades completas de vendas
- `financial_full`: Controle financeiro avançado
- `crm_full`: CRM completo
- `additional_cnpj`: Suporte a CNPJs adicionais
- `sectors_management`: Gestão de setores

## Sistema de Limites

### Campo trialEndsAt

Localização: `prisma/schema.prisma:31`

```prisma
model Company {
  // ...
  trialEndsAt DateTime?
  // ...
}
```

### Implementação de Validação de Trial

Localização: `src/core/sale/quotation/quotation.service.ts:1147-1178`

```typescript
async approve(quotationId: string): Promise<Order> {
  let isTrial = false;
  
  const companyData = await this.prisma.company.findUnique({
    where: { id: companyId },
    select: {
      trialEndsAt: true,
      Subscription: {
        where: { status: 'ACTIVE' },
        select: {
          plan: { select: { planType: true } }
        }
      }
    }
  });

  // Verifica se ainda está no período de trial
  if (companyData.trialEndsAt && companyData.trialEndsAt > new Date()) {
    isTrial = true;
  }

  // Considera plano START como trial
  if (subscription?.plan?.planType === 'START') {
    isTrial = true;
  }

  // Aplica comportamento diferente baseado no trial
  const deliveryStatus = isTrial ? 'DELIVERING' : 'IN_PRODUCTION';
}
```

### Limites por Plano

| Plano | Usuários Máx | Preço Adicional/Usuário | Características |
|-------|--------------|--------------------------|-----------------|
| TRIAL | 3 | R$ 0,00 | 7 dias gratuitos |
| START | 3 | R$ 15,00 | Funcionalidades básicas |
| LITE | 5 | R$ 20,00 | Inclui CRM |
| PRO | Ilimitado | R$ 25,00 | Relatórios avançados |
| ELITE | Ilimitado | R$ 30,00 | Gerenciador de produção |
| FULL | Ilimitado | R$ 35,00 | Gestão completa |

## Implementação Atual

### O que está implementado ✅

1. **Estrutura de planos e módulos**: Definição completa no banco de dados
2. **Sistema de assinaturas**: Criação e gestão de subscriptions
3. **Trial automático**: Criação automática de trial de 7 dias
4. **Features por plano**: Mapeamento de funcionalidades (informativo)
5. **Validação específica**: Uma validação no processo de aprovação de quotations
6. **Sistema de permissões**: Guard de permissões por role (independente de plano)

### O que NÃO está implementado ❌

1. **Validações de limite de usuários**: Não há verificação do número máximo de employees/users
2. **Bloqueios por expiração de trial**: Sem middleware que impeça ações após `trialEndsAt`
3. **Guards específicos de plano**: Não há guards que validem funcionalidades por plano
4. **Validações em services**: Services não verificam limites antes de criar registros
5. **Middleware centralizado**: Não há interceptor global para aplicar limitações
6. **Validação de módulos**: Não há verificação se módulos estão disponíveis na subscription

## Guards e Middleware

### Permissions Guard

Localização: `src/core/auth/abac/permissions.guard.ts`

```typescript
@Injectable()
export class PermissionsGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user = request.user;
    
    if (!user || !user.role) return false;

    const requiredPermission = this.reflector.get<{
      action: string;
      resource: string;
    }>(HAS_PERMISSION_KEY, context.getHandler());

    if (!requiredPermission) return true;

    const userPermissions = await this.abacService.getPermissionsByRole(user.role);
    
    if (userPermissions.isAdmin) {
      return true;
    }

    const permissionString = `${requiredPermission.resource}:${requiredPermission.action}`;
    return userPermissions.permissions.includes(permissionString);
  }
}
```

**Nota**: Este guard verifica permissões por role, mas não integra com limitações de plano.

### ABAC Service

Localização: `src/core/auth/abac/abac.service.ts`

```typescript
@Injectable()
export class AbacService {
  async getPermissionsByRole(role: string): Promise<Partial<Role>> {
    return this.prisma.role.findUnique({
      where: { id: role },
      select: {
        permissions: true,
        isAdmin: true,
      },
    });
  }

  async hasPermission(
    user: { userId: string; username: string },
    action: string,
    resource: string,
  ): Promise<boolean> {
    const userWithRoles = await this.userService.findOneRoles(user.userId);
    
    return userWithRoles.userRole.some((userRole) => {
      return userRole.role.permissions.some((rolePolicy) => {
        const [userResource, userActions] = rolePolicy.split(':');
        return userResource === resource && userActions.includes(action);
      });
    });
  }
}
```

## Arquivos Principais

### Estrutura e Configuração
- `prisma/schema.prisma`: Schema do banco com models de Plan, Subscription, Company
- `src/seeds/plans-base.ts`: Definição dos planos base e módulos
- `src/core/plan/plan.service.ts`: CRUD de planos

### Services de Assinatura
- `src/core/subscriptions/subscriptions.service.ts`: Gestão de subscriptions
- `src/core/customers/customers.service.ts`: Gestão de customers (Asaas)

### Controle de Acesso
- `src/core/auth/auth.service.ts`: Sistema de features e autenticação
- `src/core/auth/abac/permissions.guard.ts`: Guard de permissões
- `src/core/auth/abac/abac.service.ts`: Service de controle de acesso

### Services com Validações
- `src/core/sale/quotation/quotation.service.ts`: Única validação de trial implementada
- `src/core/user/user.service.ts`: Criação automática de trial
- `src/core/company/company.service.ts`: Configuração de `trialEndsAt`

## Recomendações

### Para Implementação Completa

1. **Criar PlanGuard**: Guard específico para validar limitações de plano
```typescript
@Injectable()
export class PlanGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Verificar subscription ativa
    // Validar limites do plano
    // Verificar módulos disponíveis
  }
}
```

2. **Implementar PlanInterceptor**: Interceptor para aplicar limitações globalmente
```typescript
@Injectable()
export class PlanInterceptor implements NestInterceptor {
  async intercept(context: ExecutionContext, next: CallHandler) {
    // Validar limites antes da execução
    // Aplicar restrições baseadas no plano
  }
}
```

3. **Validações em Services**: Adicionar verificações de limite em services críticos
```typescript
async createEmployee(data: CreateEmployeeDto, companyId: string) {
  // Verificar se não excede limite de usuários do plano
  const subscription = await this.getActiveSubscription(companyId);
  const currentUserCount = await this.getCurrentUserCount(companyId);
  
  if (currentUserCount >= subscription.plan.userLimit) {
    throw new BadRequestException('Limite de usuários excedido para este plano');
  }
  
  return this.prisma.employee.create({ data });
}
```

4. **Middleware de Trial**: Bloquear ações após expiração do trial
```typescript
@Injectable()
export class TrialMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: Function) {
    // Verificar se trial expirou
    // Bloquear ações se necessário
  }
}
```

5. **Decorators para Features**: Criar decorators para controle fino de features
```typescript
@HasFeature('advanced_reports')
@Get('/advanced-report')
async getAdvancedReport() {
  // Só executa se o plano incluir advanced_reports
}
```

### Estrutura Recomendada

```
src/
  core/
    plan/
      guards/
        plan.guard.ts
        trial.guard.ts
        feature.guard.ts
      interceptors/
        plan.interceptor.ts
      decorators/
        has-feature.decorator.ts
        plan-limit.decorator.ts
      services/
        plan-validation.service.ts
```

### Integração com Services Existentes

Todos os services que criam registros deveriam validar limites:
- `employee.service.ts`: Limite de usuários
- `client.service.ts`: Limite de clientes (se aplicável)
- `quotation.service.ts`: Limite de orçamentos (se aplicável)
- `product.service.ts`: Limite de produtos (se aplicável)

### Considerações de Performance

1. **Cache de Subscription**: Cachear dados da subscription ativa para evitar consultas repetidas
2. **Lazy Loading**: Carregar validações de plano apenas quando necessário
3. **Batch Validations**: Agrupar validações para otimizar queries

---

*Documento gerado automaticamente baseado na análise do código em: 2025-08-05*