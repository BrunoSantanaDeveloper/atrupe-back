# Sistema de Planos, Features e Limites - Atrupe API (Atualizado)

## Visão Geral

O sistema de planos, features e limites da Atrupe API foi completamente reestruturado para fornecer um controle mais granular e flexível das funcionalidades disponíveis para cada plano de assinatura. O novo sistema separa claramente:

- **Features**: Funcionalidades específicas que podem ser habilitadas por plano
- **Limits**: Restrições quantitativas aplicadas a recursos do sistema
- **Plans**: Combinação de features e limits com preços
- **Subscriptions**: Plano ativo de uma empresa com recursos adicionais contratados

## Estrutura do Banco de Dados

### Models Principais

```prisma
model Feature {
  id          String                @id @default(uuid())
  key         String                @unique // e.g., 'sectors_configuration', 'quotation_quick_sale'
  name        String                // e.g., 'Configurar Setores', 'Venda Rápida'
  description String?
  category    String?               // e.g., 'configuration', 'quotations', 'financial'
  price       Float                 @default(0) // preço adicional em centavos
  isActive    Boolean               @default(true)
  createdAt   DateTime              @default(now())
  updatedAt   DateTime?             @updatedAt
  planFeatures         PlanFeature[]
  subscriptionFeatures SubscriptionFeature[]
}

model Limit {
  id          String      @id @default(uuid())
  key         String      @unique // e.g., 'max_users', 'max_companies'
  name        String      // e.g., 'Máximo de Usuários', 'Máximo de Empresas'
  description String?
  unit        String?     // e.g., 'users', 'companies'
  isActive    Boolean     @default(true)
  createdAt   DateTime    @default(now())
  updatedAt   DateTime?   @updatedAt
  planLimits  PlanLimit[]
}

model Plan {
  id                    String         @id @default(uuid())
  description           String
  createdAt             DateTime       @default(now())
  updatedAt             DateTime?      @default(now()) @updatedAt
  companyId             String?
  name                  String         @unique
  // Campos antigos (manter por compatibilidade)
  additionalAccessPrice Float
  modules               String[]       @default([]) // DEPRECATED: usar planFeatures
  // Novos campos
  additionalUserPrice   Float?         @default(0) // Nova nomenclatura
  basePrice             Float
  planType              PlanType       @default(START)
  isActive              Boolean        @default(true)
  Company               Company?       @relation(fields: [companyId], references: [id])
  subscriptions         Subscription[]
  planFeatures          PlanFeature[]
  planLimits            PlanLimit[]
}

model Subscription {
  id                   String                @id @default(uuid())
  createdAt            DateTime              @default(now())
  updatedAt            DateTime?             @updatedAt
  companyId            String?
  // Campos antigos (manter por compatibilidade)
  additionalAccesses   Int?                  @default(0) // DEPRECATED: usar additionalUsers
  modules              String[]       @default([]) // DEPRECATED: usar subscriptionFeatures
  // Novos campos
  additionalUsers      Int                   @default(0) // usuários adicionais contratados
  asaasSubscriptionId  String                @unique
  customerId           String                @map("customer_id")
  nextDueDate          DateTime
  planId               String                @map("plan_id")
  value                Float
  status               String
  billingType          BillingType           @default(CREDIT_CARD)
  cycle                Cycle                 @default(MONTHLY)
  Company              Company?              @relation(fields: [companyId], references: [id])
  customer             Customer              @relation(fields: [customerId], references: [id])
  plan                 Plan                  @relation(fields: [planId], references: [id])
  subscriptionFeatures SubscriptionFeature[] // features adicionais contratadas
}
```

## Configuração dos Planos

### Features Disponíveis

O sistema possui 24 features específicas do Atrupe, divididas em:

1. **Features Básicas** (incluídas em todos os planos):

   - `basic_management`: Gestão Básica
   - `basic_quotations`: Orçamentos Básicos
   - `basic_service_orders`: Ordens de Serviço Básicas

2. **Features Específicas do Plano LITE** (e superiores):
   - `sectors_configuration`: Configurar Setores
   - `service_order_current_phase`: Fase Atual em Ordens de Serviço
   - `quotation_quick_sale`: Venda Rápida
   - `quotation_rejection_reasons`: Motivos de Rejeição e Cancelamento
   - `quotation_require_rejection_reason`: Solicitar Motivo de Rejeição
   - `service_order_cancellation_reason`: Motivo de Cancelamento de Ordem
   - `quotation_status_configuration`: Configurar Status de Orçamento
   - `quotation_status_column`: Coluna de Status em Orçamentos
   - `delivery_production_tabs`: Abas de Produção na Agenda
   - `delivery_production_stages`: Etapas de Produção na Agenda
   - `delivery_stage_status_change`: Alterar Status de Etapas
   - `accounts_receivable`: Contas a Receber
   - `accounts_payable`: Contas a Pagar
   - `cash_control`: Controle de Caixa
   - `bank_account_cash_control_switch`: Switch Controle de Caixa
   - `pdv_screen`: Tela PDV
   - `bank_account_creation`: Criação de Conta Bancária
   - `payment_condition_operator_fee`: Taxa Operadora em Condições de Pagamento
   - `credit_limit_configuration`: Configurar Limite de Crédito
   - `product_composition`: Produto Composto
   - `product_production_stages`: Etapas de Produção em Produtos
   - `client_additional_tabs`: Abas Adicionais em Clientes
   - `supplier_additional_tabs`: Abas Adicionais em Fornecedores

### Limites Disponíveis

```typescript
export const BASE_LIMITS = [
  {
    key: 'max_users',
    name: 'Máximo de Usuários',
    description: 'Número máximo de usuários permitidos no sistema',
    unit: 'users',
    isActive: true,
  },
  {
    key: 'max_companies',
    name: 'Máximo de Empresas',
    description: 'Número máximo de empresas que podem ser gerenciadas',
    unit: 'companies',
    isActive: true,
  },
  {
    key: 'trial_days',
    name: 'Dias de Trial',
    description: 'Número de dias de trial gratuito',
    unit: 'days',
    isActive: true,
  },
];
```

### Configuração dos Planos

```typescript
export const PLAN_CONFIGURATIONS = {
  TRIAL: {
    plan: {
      planType: 'TRIAL' as const,
      name: 'Trial',
      description:
        'Plano de avaliação gratuito com funcionalidades limitadas para testar o sistema por um período determinado.\n\nIncluído no Trial:\n- Até 3 usuários\n- Funcionalidades básicas\n- Acesso limitado por 7 dias\n- Suporte básico\n\nPerfeito para conhecer o sistema antes de escolher um plano pago.',
      basePrice: 0,
      additionalAccessPrice: 0,
      isActive: true,
    },
    features: ['basic_management', 'basic_quotations', 'basic_service_orders'],
    limits: {
      max_users: 3,
      max_companies: 1,
      trial_days: 7,
    },
  },

  START: {
    plan: {
      planType: 'START' as const,
      name: 'Start',
      description:
        'Conceito:\nNa jornada da excelência, tudo começa com a organização e estruturação das informações. Esse ponto de partida cria as bases para que o negócio avance de forma organizada e profissional.\n\nObjetivo:\nDigitalizar e estruturar as informações principais, garantindo um início profissional e funcional.\n\nPrincipais Ações:\n- Cadastro de clientes, fornecedores, colaboradores e produtos.\n- Organização financeira básica: plano de contas, despesas fixas, folha de pagamento e receitas.\n- Implementação de um sistema simples para emissão de pedidos, controle financeiro básico e aparência profissional.\n\nResultados Esperados:\nA empresa sai do improviso, garantindo que nenhum trabalho seja esquecido, com informações organizadas e uma imagem mais profissional.',
      basePrice: 11500, // R$ 115,00 em centavos
      additionalAccessPrice: 1500, // R$ 15,00 em centavos
      isActive: true,
    },
    features: ['basic_management', 'basic_quotations', 'basic_service_orders'],
    limits: {
      max_users: 3,
      max_companies: 1,
      trial_days: 0,
    },
  },

  LITE: {
    plan: {
      planType: 'LITE' as const,
      name: 'Lite',
      description:
        'Conceito:\nCom as bases lançadas na Etapa Start, o próximo passo é fortalecer a estabilidade financeira e comercial do negócio por meio de ferramentas mais robustas.\n\nObjetivo:\nAprofundar o controle financeiro da empresa enquanto integra informações comerciais (CRM) para facilitar tomadas de decisão estratégicas.\n\nPrincipais Ações:\n- Cadastro de produtos com composições básicas.\n- Controle financeiro avançado:\n  - Separação por contas bancárias.\n  - Definição de limites de crédito para clientes.\n  - Opção para repasse automático das taxas financeiras.\n- Introdução ao CRM (Gestão Comercial):\n  - Status das negociações em andamento.\n  - Motivos dos cancelamentos registrados no sistema.\n  - Histórico completo dos clientes.\n\nResultados Esperados:\nA empresa ganha previsibilidade financeira:\n- Redução significativa nas perdas financeiras;\n- Melhor controle sobre vendas/compras;\n- Decisões comerciais mais assertivas graças ao CRM integrado.\n\nObservação:\nAs informações cadastradas aqui evoluem diretamente pra próxima etapa — sem retrabalho!',
      basePrice: 23000, // R$ 230,00 em centavos
      additionalAccessPrice: 2000, // R$ 20,00 em centavos
      isActive: true,
    },
    features: [
      // Features básicas
      'basic_management',
      'basic_quotations',
      'basic_service_orders',

      // Features específicas do LITE
      'sectors_configuration',
      'service_order_current_phase',
      'quotation_quick_sale',
      'quotation_rejection_reasons',
      'quotation_require_rejection_reason',
      'service_order_cancellation_reason',
      'quotation_status_configuration',
      'quotation_status_column',
      'delivery_production_tabs',
      'delivery_production_stages',
      'delivery_stage_status_change',
      'accounts_receivable',
      'accounts_payable',
      'cash_control',
      'bank_account_cash_control_switch',
      'pdv_screen',
      'bank_account_creation',
      'payment_condition_operator_fee',
      'credit_limit_configuration',
      'product_composition',
      'product_production_stages',
      'client_additional_tabs',
      'supplier_additional_tabs',
    ],
    limits: {
      max_users: 5,
      max_companies: 1,
      trial_days: 0,
    },
  },
  // ... (PRO, ELITE e FULL seguem padrão similar)
};
```

## Implementação dos Services

### PlanControlService

O `PlanControlService` é o serviço central para controle de planos, features e limits:

```typescript
export interface CompanyLimits {
  [key: string]: number; // Sistema dinâmico - qualquer limite
}

interface CompanyFeatures {
  [key: string]: boolean;
}

interface PlanInfo {
  planId: string;
  planType: string;
  planName: string;
  features: CompanyFeatures;
  limits: CompanyLimits;
  additionalUsers: number;
  isTrialActive: boolean;
  trialEndsAt?: Date;
}

@Injectable()
export class PlanControlService {
  constructor(private prisma: PrismaService) {}

  /**
   * Obter informações completas do plano da empresa
   */
  async getCompanyPlanInfo(companyId: string): Promise<PlanInfo> {
    // Implementação que busca informações do plano, features e limits
  }

  /**
   * Verificar se empresa tem uma feature específica
   */
  async hasFeature(companyId: string, featureKey: string): Promise<boolean> {
    // Verifica se a empresa tem acesso a uma feature específica
  }

  /**
   * Verificar se empresa está dentro do limite para um recurso
   */
  async checkLimit(
    companyId: string,
    limitKey: string,
    currentUsage: number,
  ): Promise<boolean> {
    // Verifica se o uso atual está dentro do limite permitido
  }

  /**
   * Enforçar limite - lança exceção se excedido
   */
  async enforceLimit(
    companyId: string,
    limitKey: string,
    currentUsage: number,
  ): Promise<void> {
    // Lança exceção se o limite for excedido
  }

  /**
   * Enforçar feature - lança exceção se não disponível
   */
  async enforceFeature(companyId: string, featureKey: string): Promise<void> {
    // Lança exceção se a feature não estiver disponível
  }
}
```

### AuthService

O `AuthService` foi atualizado para usar o novo sistema:

```typescript
@Injectable()
export class AuthService {
  constructor(
    private usersService: UserService,
    private jwtService: JwtService,
    private planControlService: PlanControlService,
  ) {}

  async login(user: any) {
    try {
      // Obter informações do plano usando o novo sistema
      const companyId = user.employee[0]?.company.id;
      const planInfo = companyId
        ? await this.planControlService.getCompanyPlanInfo(companyId)
        : null;

      const subscription = planInfo?.planType ?? 'TRIAL';

      const payload = {
        username: user.email,
        sub: user.id,
        companyId: companyId,
        role: user.employee[0]?.role?.id,
        isAdmin: user.employee[0]?.role?.isAdmin,
        employeeId: user.employee[0]?.id,
        subscription: subscription,
      };

      return {
        id: user.id,
        name: user.employee[0]?.name ?? user.name,
        email: user.email,
        avatar: user.employee[0]?.avatarUrl,
        role: user.employee[0] ? user.employee[0].role?.name : null,
        employeeId: user.employee[0]?.id,
        isAdmin: user.employee[0]?.role?.isAdmin,
        permissions: user.employee[0]?.role?.permissions,
        company: user.employee[0]?.company
          ? {
              id: user.employee[0].company.id,
              name: user.employee[0].company.name,
              legalName: user.employee[0].company.legalName,
              logo: user.employee[0].company.logoUrl,
              favicon: user.employee[0].company.favIconUrl,
              subscription: subscription,
              trialEndsAt:
                planInfo?.trialEndsAt ?? user.employee[0].company.trialEndsAt,
              features: await this.getPlanFeatures(user.employee[0].company.id),
              limits: planInfo?.limits || null, // Sistema dinâmico - todos os limites automaticamente
            }
          : null,
        access_token: this.jwtService.sign(payload),
      };
    } catch (error) {
      console.log(error);
      throw new Error('Erro ao gerar token');
    }
  }
}
```

## Uso dos Guards e Decorators

### FeatureGuard

```typescript
export const REQUIRED_FEATURE_KEY = 'requiredFeature';

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private planControlService: PlanControlService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredFeature = this.reflector.get<string>(
      REQUIRED_FEATURE_KEY,
      context.getHandler(),
    );

    if (!requiredFeature) {
      return true; // Se não há feature requerida, permite acesso
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user?.companyId) {
      return false;
    }

    try {
      await this.planControlService.enforceFeature(
        user.companyId,
        requiredFeature,
      );
      return true;
    } catch (error) {
      return false; // Guard retorna false, a exceção será tratada pelo service
    }
  }
}
```

### LimitGuard

```typescript
export const REQUIRED_LIMIT_KEY = 'requiredLimit';

export interface LimitConfig {
  key: string;
  action: 'create' | 'check'; // create = vai criar +1, check = só verificar atual
}

@Injectable()
export class LimitGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private planControlService: PlanControlService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const limitConfig = this.reflector.get<LimitConfig>(
      REQUIRED_LIMIT_KEY,
      context.getHandler(),
    );

    if (!limitConfig) {
      return true; // Se não há limite requerido, permite acesso
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user?.companyId) {
      return false;
    }

    try {
      let currentUsage = 0;

      // Obter uso atual baseado no tipo de limite
      switch (limitConfig.key) {
        case 'max_users':
          currentUsage = await this.planControlService.getCurrentUserCount(
            user.companyId,
          );
          break;
        case 'max_companies':
          currentUsage = await this.planControlService.getCurrentCompanyCount(
            user.companyId,
          );
          break;
        default:
          return true; // Limite não conhecido = permitido
      }

      // Se é uma ação de criação, simular +1 no uso atual
      if (limitConfig.action === 'create') {
        currentUsage += 1;
      }

      await this.planControlService.enforceLimit(
        user.companyId,
        limitConfig.key,
        currentUsage,
      );
      return true;
    } catch (error) {
      return false; // Guard retorna false, a exceção será tratada pelo service
    }
  }
}
```

### Decorators

```typescript
// RequiresFeature decorator
export const RequiresFeature = (feature: string) =>
  SetMetadata(REQUIRED_FEATURE_KEY, feature);

// RequiresLimit decorator
export const RequiresLimit = (
  key: string,
  action: 'create' | 'check' = 'create',
) => SetMetadata(REQUIRED_LIMIT_KEY, { key, action } as LimitConfig);
```

## Como Usar

### Frontend (React/Next.js)

```typescript
// Hook personalizado para controle de features
import { useSession } from 'next-auth/react'

export function usePlanFeatures() {
  const { data: session } = useSession()

  const hasFeature = (feature: string) => {
    if (!session?.company?.features) return false
    return session.company.features.includes(feature)
  }

  const hasAnyFeature = (features: string[]) => {
    return features.some((feature) => hasFeature(feature))
  }

  const hasAllFeatures = (features: string[]) => {
    return features.every((feature) => hasFeature(feature))
  }

  return {
    hasFeature,
    hasAnyFeature,
    hasAllFeatures,
    planName: session?.company?.subscription,
    limits: session?.company?.limits,
  }
}

// Uso no componente
export function MyComponent() {
  const { hasFeature, hasAllFeatures } = usePlanFeatures()

  return (
    <div>
      {hasFeature('sectors_configuration') && (
        <SectorsConfigurationComponent />
      )}

      {hasAllFeatures(['accounts_receivable', 'accounts_payable']) && (
        <FinancialDashboard />
      )}

      {!hasFeature('advanced_reports') && (
        <UpgradePlanBanner />
      )}
    </div>
  )
}
```

### Backend (NestJS Controllers)

```typescript
@Controller('sectors')
export class SectorsController {
  constructor(private sectorsService: SectorsService) {}

  // Endpoint que requer feature específica
  @Get('/configuration')
  @UseGuards(FeatureGuard)
  @RequiresFeature('sectors_configuration')
  async getSectorsConfig() {
    return this.sectorsService.getConfiguration();
  }

  // Endpoint que verifica limite antes de criar
  @Post('/')
  @UseGuards(LimitGuard)
  @RequiresLimit('max_users', 'create')
  async createSector(@Body() createSectorDto: CreateSectorDto) {
    return this.sectorsService.create(createSectorDto);
  }
}
```

### Backend (NestJS Services)

```typescript
@Injectable()
export class UserService {
  constructor(private planControlService: PlanControlService) {}

  async createUser(companyId: string, createUserDto: CreateUserDto) {
    // Verificar limite de usuários
    const currentUsers =
      await this.planControlService.getCurrentUserCount(companyId);
    await this.planControlService.enforceLimit(
      companyId,
      'max_users',
      currentUsers + 1,
    );

    // Verificar feature específica se necessário
    await this.planControlService.enforceFeature(companyId, 'user_management');

    // Criar usuário
    return this.prisma.user.create({ data: createUserDto });
  }
}
```

## Benefícios do Novo Sistema

1. **Separação Clara de Conceitos**:

   - Features: Funcionalidades (o que pode fazer)
   - Limits: Quantidades (quanto pode fazer)

2. **Flexibilidade Total**:

   - Planos podem ter qualquer combinação de features e limits
   - Subscriptions podem adicionar features e usuários extras
   - Fácil criação de novos planos sem código

3. **Controle Granular**:

   - Guards automáticos verificam features e limites
   - Enforcement programático via service
   - Mensagens de erro personalizadas

4. **Escalabilidade**:

   - Sistema preparado para crescimento
   - Fácil adição de novas features e limites
   - Suporte a recursos adicionais na subscription

5. **Auditoria e Transparência**:
   - Histórico completo de features e limites por subscription
   - Preços individualizados por recurso adicional
   - Fácil geração de relatórios de uso

## Comandos Úteis

### Popular o Banco de Dados

```bash
# Executar migração do Prisma
npx prisma migrate dev

# Executar seed
npx ts-node src/scripts/migrate-and-seed-plans.ts
```

### Verificar Dados

```bash
# Verificar contagem de registros
npx prisma db execute --stdin <<< "SELECT COUNT(*) FROM features;"
npx prisma db execute --stdin <<< "SELECT COUNT(*) FROM limits;"
npx prisma db execute --stdin <<< "SELECT COUNT(*) FROM plans;"
```

## Considerações Finais

O novo sistema de planos, features e limits da Atrupe API proporciona um controle muito mais preciso e flexível das funcionalidades disponíveis para cada tipo de assinatura. A separação clara entre features (funcionalidades) e limits (quantidades) permite uma gestão mais eficiente dos recursos do sistema e uma experiência mais personalizada para os usuários.

A implementação atual está totalmente funcional e integrada com todos os aspectos do sistema, desde a autenticação até os guards de proteção de endpoints. O sistema é facilmente escalável para acomodar novas features e limits conforme o produto evolui.
