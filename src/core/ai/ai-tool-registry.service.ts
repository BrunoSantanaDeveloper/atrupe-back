import { Injectable } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { AbacService } from '../auth/abac/abac.service';
import { DASHBOARD_SALES_MONEY_FIELDS } from '../auth/abac/money-fields';
import { omitMoneyFields } from '../auth/abac/values-visibility.interceptor';
import { PlanControlService } from '../plan/plan-control.service';
import { ReportService } from '../../svc/report/report.service';
import {
  AiOperationalQueryDeniedError,
  AiOperationalQueryService,
} from './ai-operational-query.service';
import { AiHelpContentService } from './ai-help-content.service';
import {
  AiRegistrationQueryDeniedError,
  AiRegistrationQueryService,
} from './ai-registration-query.service';
import { AiActionService, AiActionSummary } from './ai-action.service';
import {
  AI_PLAN_DENIED_REASON,
  AiPlanFeatures,
  enabledFeatures,
} from './ai-plan';
import {
  AiProposalDeniedError,
  AiQuotationDraftService,
} from './ai-quotation-draft.service';
import { AiSafetyService } from './ai-safety.service';
import { AI_FEATURE } from './ai-usage.service';
import {
  AiRequestUser,
  AiToolDefinition,
  AiToolExecutionResult,
} from './ai.types';

type ToolArgs = Record<string, unknown>;

/** O que a ferramenta sabe da mensagem além dos argumentos do modelo. */
export interface AiToolContext {
  conversationId?: string;
  /** A tela atual: o orçamento aberto é o alvo do CURRENT */
  currentPath?: string;
  /** O orçamento do botão "Montar com IA" */
  quotationId?: string;
}

const QUOTATION_PATH = /\/vendas\/orcamentos\/([0-9a-f-]{36})(?:[/?#]|$)/i;

export { AI_PLAN_DENIED_REASON, enabledFeatures };
export type { AiPlanFeatures };

/**
 * O recurso de plano de cada ferramenta, além do ai_assistant. Sem entrada,
 * a ferramenta vale para todo plano com o assistente.
 */
const TOOL_FEATURES: Record<string, string[]> = {};

/**
 * As consultas operacionais conferem o recurso pela entidade: a mesma chave
 * que fecha a tela fecha a pergunta pelo chat (contas a receber e a pagar no
 * LITE, notas com o módulo de nota fiscal).
 */
const OPERATIONAL_ENTITY_FEATURES: Record<string, string> = {
  receivables: 'accounts_receivable',
  payables: 'accounts_payable',
  nfes: 'nota_fiscal',
  nfses: 'nota_fiscal',
  nfces: 'nota_fiscal',
};

const OPERATIONAL_TOOLS = [
  'query_operational_metrics',
  'search_operational_records',
  'get_operational_record_details',
];

/** O resumo e os rankings de vendas: o valor só para quem vê valores. */
const SALES_MONEY_FIELDS = new Set(DASHBOARD_SALES_MONEY_FIELDS);

@Injectable()
export class AiToolRegistry {
  constructor(
    private readonly prisma: PrismaService,
    private readonly abacService: AbacService,
    private readonly reportService: ReportService,
    private readonly safety: AiSafetyService,
    private readonly operationalQuery: AiOperationalQueryService,
    private readonly helpContent: AiHelpContentService,
    private readonly registrationQuery: AiRegistrationQueryService,
    private readonly planControl: PlanControlService,
    private readonly drafts: AiQuotationDraftService,
    private readonly actions: AiActionService,
  ) {}

  /** Os recursos de plano da empresa, lidos uma vez por mensagem. */
  async planFeatures(companyId: string): Promise<AiPlanFeatures> {
    const plan = await this.planControl.getCompanyPlanInfo(companyId);
    return enabledFeatures(plan?.features);
  }

  /**
   * As ferramentas do plano da empresa: o modelo não oferece o que a empresa
   * não tem. Nas consultas operacionais, só as entidades do plano.
   */
  getDefinitions(features: AiPlanFeatures): AiToolDefinition[] {
    return this.allDefinitions()
      .filter((tool) =>
        (TOOL_FEATURES[tool.function.name] ?? []).every((key) =>
          features.has(key),
        ),
      )
      .map((tool) =>
        OPERATIONAL_TOOLS.includes(tool.function.name)
          ? this.withEntities(tool, features)
          : tool,
      );
  }

  private allDefinitions(): AiToolDefinition[] {
    return [
      this.tool(
        'get_report_menu',
        'Resumo dos menus de relatórios disponíveis.',
      ),
      this.tool(
        'get_financial_summary',
        'Resumo financeiro de receitas ou despesas no período informado.',
        this.reportFilterSchema(['receitas', 'despesas']),
      ),
      this.tool(
        'get_financial_table',
        'Tabela financeira paginada de receitas ou despesas no período informado.',
        this.reportFilterSchema(['receitas', 'despesas'], true),
      ),
      this.tool(
        'get_cash_flow_summary',
        'Resumo de projeção de caixa com receitas, despesas e saldo esperados.',
        this.reportFilterSchema(['all', 'revenue', 'expense']),
      ),
      this.tool(
        'get_sales_summary',
        'Resumo de vendas, aprovações, rejeições, ticket médio e comissão.',
        this.salesFilterSchema(),
      ),
      this.tool(
        'query_operational_metrics',
        'Consulta metricas autorizadas da empresa logada. Use para perguntas quantitativas sobre ordens de servico, pedidos, orcamentos, contas a receber, contas a pagar e documentos fiscais, incluindo contagens e somas permitidas por status.',
        this.operationalQuery.getToolSchema(),
      ),
      this.tool(
        'search_operational_records',
        'Busca uma lista resumida de registros autorizados. Use quando o usuario pedir quais ordens de servico, pedidos, orcamentos, recebiveis, despesas ou documentos fiscais atendem a um criterio.',
        this.operationalQuery.getSearchToolSchema(),
      ),
      this.tool(
        'get_operational_record_details',
        'Consulta detalhes resumidos de um registro autorizado pelo ID retornado em uma busca.',
        this.operationalQuery.getDetailsToolSchema(),
      ),
      this.tool(
        'query_registration_metrics',
        'Consulta metricas cadastrais autorizadas para clientes, fornecedores e produtos. Use para contagens e pendencias fiscais.',
        this.registrationQuery.getMetricsToolSchema(),
      ),
      this.tool(
        'search_registration_records',
        'Busca cadastros resumidos e pendencias fiscais autorizadas de clientes, fornecedores e produtos.',
        this.registrationQuery.getSearchToolSchema(),
      ),
      this.tool(
        'get_registration_record_details',
        'Consulta detalhes resumidos e pendencias fiscais de um cadastro autorizado pelo ID retornado em uma busca.',
        this.registrationQuery.getDetailsToolSchema(),
      ),
      this.tool(
        'get_sales_top_clients',
        'Ranking dos principais clientes em vendas.',
        this.salesFilterSchema(),
      ),
      this.tool(
        'get_sales_top_products',
        'Ranking dos principais produtos em vendas.',
        this.salesFilterSchema(),
      ),
      this.tool(
        'get_commission_summary',
        'Resumo de comissões por período de venda ou recebimento.',
        this.salesFilterSchema(),
      ),
      this.tool(
        'search_help_content',
        'Busca orientacoes sobre processos e materiais da academia. Use para responder como realizar uma operacao ou utilizar uma funcionalidade do Atrupe.',
        {
          type: 'object',
          properties: {
            query: { type: 'string' },
            currentPath: { type: 'string' },
          },
          required: ['query'],
        },
      ),
      this.tool(
        'get_fiscal_setup_context',
        'Consulta somente a disponibilidade e o estagio de configuracao do modulo fiscal da empresa logada. Use para personalizar orientacoes sobre ativacao ou emissao fiscal.',
      ),
      this.tool(
        'get_company_basic_context',
        'Nome e situação da conta (ativa, nível de bloqueio) da empresa logada.',
      ),
      this.tool(
        'propose_quotation_draft',
        'Monta a proposta de um orçamento a partir do pedido do cliente: cliente, produtos, medidas, quantidades e entrega. Não grava nada: a pessoa confere o cartão e clica em Aplicar. Nunca mande preço; o servidor calcula.',
        this.drafts.getToolSchema(),
      ),
    ];
  }

  async execute(
    name: string,
    args: ToolArgs,
    user: AiRequestUser,
    features?: AiPlanFeatures,
    context: AiToolContext = {},
  ): Promise<AiToolExecutionResult> {
    try {
      if (!user.companyId)
        return this.denied(name, 'Usuário sem empresa ativa.');

      // O plano de novo, mesmo fora da lista: o modelo pode chamar o nome
      // de uma ferramenta que não recebeu
      const plan = features ?? (await this.planFeatures(user.companyId));
      if (!this.allowedByPlan(name, args, plan)) {
        return this.denied(name, AI_PLAN_DENIED_REASON);
      }

      switch (name) {
        case 'get_report_menu':
          return this.success(
            name,
            await this.reportService.menu(user.companyId),
          );
        case 'get_financial_summary':
          await this.ensureFinancial(user, name);
          return this.success(
            name,
            await this.reportService.getFinancialSummary(
              user.companyId,
              this.cleanFilters(args, [
                'tab',
                'startDate',
                'endDate',
                'status',
                'clientId',
                'groupBy',
                'orderBy',
                'page',
                'limit',
              ]),
            ),
          );
        case 'get_financial_table':
          await this.ensureFinancial(user, name);
          return this.success(
            name,
            await this.reportService.getFinancialTable(
              user.companyId,
              this.cleanFilters({ limit: 10, ...args }, [
                'tab',
                'startDate',
                'endDate',
                'status',
                'clientId',
                'groupBy',
                'orderBy',
                'page',
                'limit',
              ]),
            ),
          );
        case 'get_cash_flow_summary':
          await this.ensureFinancial(user, name);
          return this.success(
            name,
            await this.reportService.getCashFlowSummary(
              user.companyId,
              this.cleanFilters(args, [
                'startDate',
                'endDate',
                'movement',
                'groupBy',
                'orderBy',
                'page',
                'limit',
              ]),
            ),
          );
        case 'get_sales_summary':
          return this.success(
            name,
            await this.salesValues(
              user,
              await this.reportService.getSalesReportSummary(
                user.companyId,
                await this.salesFilters(user, args, name),
              ),
            ),
          );
        case 'query_operational_metrics':
          return this.success(
            name,
            await this.operationalQuery.query(args, user),
          );
        case 'search_operational_records':
          return this.success(
            name,
            await this.operationalQuery.search(args, user),
          );
        case 'get_operational_record_details':
          return this.success(
            name,
            await this.operationalQuery.details(args, user),
          );
        case 'query_registration_metrics':
          return this.success(
            name,
            await this.registrationQuery.query(args, user),
          );
        case 'search_registration_records':
          return this.success(
            name,
            await this.registrationQuery.search(args, user),
          );
        case 'get_registration_record_details':
          return this.success(
            name,
            await this.registrationQuery.details(args, user),
          );
        case 'get_sales_top_clients':
          return this.success(
            name,
            await this.salesValues(
              user,
              await this.reportService.getTopClients(
                user.companyId,
                await this.salesFilters(user, args, name),
              ),
            ),
          );
        case 'get_sales_top_products':
          return this.success(
            name,
            await this.salesValues(
              user,
              await this.reportService.getTopProducts(
                user.companyId,
                await this.salesFilters(user, args, name),
              ),
            ),
          );
        case 'get_commission_summary':
          await this.ensureFinancial(user, name);
          return this.success(
            name,
            await this.reportService.getCommissionSummary(
              user.companyId,
              this.cleanFilters(args, [
                'commissionType',
                'startDate',
                'endDate',
                'receivedStartDate',
                'receivedEndDate',
                'sellerId',
                'groupBy',
                'orderBy',
                'page',
                'limit',
              ]),
            ),
          );
        case 'search_help_content':
          return this.success(
            name,
            await this.helpContent.search(
              this.cleanFilters(args, ['query', 'currentPath']),
              user,
            ),
          );
        case 'get_fiscal_setup_context':
          return this.success(
            name,
            await this.helpContent.getFiscalSetupContext(user),
          );
        case 'get_company_basic_context':
          return this.success(
            name,
            await this.getCompanyContext(user.companyId),
          );
        case 'propose_quotation_draft': {
          const payload = await this.drafts.build(args, user, plan, {
            currentQuotationId:
              context.quotationId ?? this.quotationOnScreen(context),
          });
          const action = await this.actions.propose(
            user,
            'QUOTATION_DRAFT',
            payload,
            context.conversationId,
          );
          return this.proposal(
            name,
            this.drafts.summaryForModel(action.id, payload),
            action,
          );
        }
        default:
          return this.error(name, `Ferramenta desconhecida: ${name}`);
      }
    } catch (error) {
      if (error instanceof AiOperationalQueryDeniedError) {
        return this.denied(name, error.reason);
      }
      if (error instanceof AiRegistrationQueryDeniedError) {
        return this.denied(name, error.reason);
      }
      if (error instanceof AiProposalDeniedError) {
        return this.denied(name, error.reason);
      }
      if (error?.status === 'denied') return error.result;
      return this.error(
        name,
        error?.message || 'Falha ao executar ferramenta.',
      );
    }
  }

  private allowedByPlan(name: string, args: ToolArgs, plan: AiPlanFeatures) {
    if (!plan.has(AI_FEATURE)) return false;
    if (!(TOOL_FEATURES[name] ?? []).every((key) => plan.has(key))) {
      return false;
    }
    if (OPERATIONAL_TOOLS.includes(name)) {
      const feature = OPERATIONAL_ENTITY_FEATURES[String(args?.entity ?? '')];
      if (feature && !plan.has(feature)) return false;
    }
    return true;
  }

  /** O esquema da consulta operacional só com as entidades do plano. */
  private withEntities(
    tool: AiToolDefinition,
    features: AiPlanFeatures,
  ): AiToolDefinition {
    const parameters = tool.function.parameters as {
      properties?: Record<string, { enum?: string[] }>;
    };
    const entity = parameters.properties?.entity;
    if (!entity?.enum) return tool;
    const allowed = entity.enum.filter((value) => {
      const feature = OPERATIONAL_ENTITY_FEATURES[value];
      return !feature || features.has(feature);
    });
    return {
      ...tool,
      function: {
        ...tool.function,
        parameters: {
          ...parameters,
          properties: {
            ...parameters.properties,
            entity: { ...entity, enum: allowed },
          },
        },
      },
    };
  }

  /**
   * Sem values:values, o resumo e os rankings de vendas saem só com as
   * contagens e os nomes, como no painel inicial. Aqui vale sempre (não só
   * com VALUES_VISIBILITY_ENFORCE): o que a ferramenta devolve vai ao
   * provedor.
   */
  private async salesValues<T>(user: AiRequestUser, content: T): Promise<T> {
    const canSeeValues = await this.abacService.hasPermission(
      user,
      'view',
      'values:values',
    );
    return canSeeValues
      ? content
      : omitMoneyFields(content, SALES_MONEY_FIELDS);
  }

  private tool(
    name: string,
    description: string,
    parameters: Record<string, unknown> = { type: 'object', properties: {} },
  ): AiToolDefinition {
    return {
      type: 'function',
      function: { name, description, parameters },
    };
  }

  private reportFilterSchema(enumValues: string[], withPagination = false) {
    return {
      type: 'object',
      properties: {
        tab: { type: 'string', enum: enumValues },
        movement: { type: 'string', enum: enumValues },
        startDate: { type: 'string', description: 'YYYY-MM-DD' },
        endDate: { type: 'string', description: 'YYYY-MM-DD' },
        status: { type: 'string' },
        groupBy: { type: 'string' },
        orderBy: { type: 'string' },
        ...(withPagination
          ? { page: { type: 'number' }, limit: { type: 'number' } }
          : {}),
      },
    };
  }

  private salesFilterSchema() {
    return {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'YYYY-MM-DD' },
        endDate: { type: 'string', description: 'YYYY-MM-DD' },
        sellerId: { type: 'string' },
        clientId: { type: 'string' },
        originId: { type: 'string' },
        serieId: { type: 'string' },
      },
    };
  }

  private async ensureFinancial(user: AiRequestUser, toolName: string) {
    const canSeeFlow = await this.abacService.hasPermission(
      user,
      'view',
      'financial:flow',
    );
    const canSeeValues = await this.abacService.hasPermission(
      user,
      'view',
      'values:values',
    );
    if (!canSeeFlow || !canSeeValues) {
      throw {
        status: 'denied',
        result: this.denied(
          toolName,
          'Sem permissão para consultar dados financeiros e valores.',
        ),
      };
    }
  }

  private async salesFilters(
    user: AiRequestUser,
    args: ToolArgs,
    toolName: string,
  ) {
    const canSeeQuotations = await this.abacService.hasPermission(
      user,
      'view',
      'sale:quotation',
    );
    const canSeeOrders = await this.abacService.hasPermission(
      user,
      'view',
      'sale:order',
    );
    if (!canSeeQuotations && !canSeeOrders) {
      throw {
        status: 'denied',
        result: this.denied(toolName, 'Sem permissão para consultar vendas.'),
      };
    }

    const filters = this.cleanFilters(args, [
      'sellerId',
      'originId',
      'clientId',
      'serieId',
      'status',
      'startDate',
      'endDate',
      'dateField',
      'groupBy',
      'orderBy',
      'page',
      'limit',
    ]);
    const canSeeOtherSellers =
      await this.abacService.canAccessOtherSellers(user);

    if (!canSeeOtherSellers && !user.isAdmin && user.employeeId) {
      filters.sellerId = user.employeeId;
    }

    return filters;
  }

  private cleanFilters(args: ToolArgs, allowedKeys: string[]) {
    return this.safety.sanitizeToolArguments(args, allowedKeys).clean;
  }

  // O provedor recebe o mínimo: o nome e a situação da conta. Nada que
  // identifique a empresa fora do Atrupe (CNPJ e razão social, que no MEI
  // é o nome do dono) nem o id interno
  private getCompanyContext(companyId: string) {
    return this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        name: true,
        blockLevel: true,
        isActive: true,
      },
    });
  }

  private success(name: string, content: unknown): AiToolExecutionResult {
    return { name, status: 'success', content };
  }

  /** A proposta: o resumo vai ao modelo; o cartão, à resposta do chat. */
  private proposal(
    name: string,
    content: unknown,
    action: AiActionSummary,
  ): AiToolExecutionResult {
    return { name, status: 'success', content, action };
  }

  private quotationOnScreen(context: AiToolContext) {
    return QUOTATION_PATH.exec(context.currentPath ?? '')?.[1];
  }

  private denied(name: string, reason: string): AiToolExecutionResult {
    return { name, status: 'denied', content: { reason } };
  }

  private error(name: string, message: string): AiToolExecutionResult {
    return { name, status: 'error', content: { message } };
  }
}
