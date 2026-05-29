import { Injectable } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { AbacService } from '../auth/abac/abac.service';
import { ReportService } from '../../svc/report/report.service';
import {
  AiRequestUser,
  AiToolDefinition,
  AiToolExecutionResult,
} from './ai.types';

type ToolArgs = Record<string, any>;

@Injectable()
export class AiToolRegistry {
  constructor(
    private readonly prisma: PrismaService,
    private readonly abacService: AbacService,
    private readonly reportService: ReportService,
  ) {}

  getDefinitions(): AiToolDefinition[] {
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
      this.tool('search_help_content', 'Busca ajuda e materiais da academia.', {
        type: 'object',
        properties: {
          query: { type: 'string' },
          currentPath: { type: 'string' },
        },
        required: ['query'],
      }),
      this.tool(
        'get_company_basic_context',
        'Contexto básico da empresa logada, sem dados sensíveis.',
      ),
    ];
  }

  async execute(
    name: string,
    args: ToolArgs,
    user: AiRequestUser,
  ): Promise<AiToolExecutionResult> {
    try {
      if (!user.companyId)
        return this.denied(name, 'Usuário sem empresa ativa.');

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
              this.cleanFilters(args),
            ),
          );
        case 'get_financial_table':
          await this.ensureFinancial(user, name);
          return this.success(
            name,
            await this.reportService.getFinancialTable(
              user.companyId,
              this.cleanFilters({ limit: 10, ...args }),
            ),
          );
        case 'get_cash_flow_summary':
          await this.ensureFinancial(user, name);
          return this.success(
            name,
            await this.reportService.getCashFlowSummary(
              user.companyId,
              this.cleanFilters(args),
            ),
          );
        case 'get_sales_summary':
          return this.success(
            name,
            await this.reportService.getSalesReportSummary(
              user.companyId,
              await this.salesFilters(user, args, name),
            ),
          );
        case 'get_sales_top_clients':
          return this.success(
            name,
            await this.reportService.getTopClients(
              user.companyId,
              await this.salesFilters(user, args, name),
            ),
          );
        case 'get_sales_top_products':
          return this.success(
            name,
            await this.reportService.getTopProducts(
              user.companyId,
              await this.salesFilters(user, args, name),
            ),
          );
        case 'get_commission_summary':
          await this.ensureFinancial(user, name);
          return this.success(
            name,
            await this.reportService.getCommissionSummary(
              user.companyId,
              this.cleanFilters(args),
            ),
          );
        case 'search_help_content':
          return this.success(
            name,
            await this.searchHelp(args, user.companyId),
          );
        case 'get_company_basic_context':
          return this.success(
            name,
            await this.getCompanyContext(user.companyId),
          );
        default:
          return this.error(name, `Ferramenta desconhecida: ${name}`);
      }
    } catch (error) {
      if (error?.status === 'denied') return error.result;
      return this.error(
        name,
        error?.message || 'Falha ao executar ferramenta.',
      );
    }
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

    const filters = this.cleanFilters(args);
    const canSeeOtherSellers = await this.abacService.hasPermission(
      user,
      'view',
      'sale:other_quotation',
    );

    if (!canSeeOtherSellers && !user.isAdmin && user.employeeId) {
      filters.sellerId = user.employeeId;
    }

    return filters;
  }

  private cleanFilters(args: ToolArgs) {
    const clean: ToolArgs = {};
    for (const [key, value] of Object.entries(args || {})) {
      if (value !== undefined && value !== null && value !== '')
        clean[key] = value;
    }
    return clean;
  }

  private async searchHelp(args: ToolArgs, companyId: string) {
    const query = String(args?.query || '').trim();
    const currentPath = String(args?.currentPath || '').trim();
    const terms = [query, currentPath].filter(Boolean);

    const items = await this.prisma.academySystem.findMany({
      where: terms.length
        ? {
            OR: terms.flatMap((term) => [
              { title: { contains: term, mode: 'insensitive' } },
              { description: { contains: term, mode: 'insensitive' } },
              { page: { contains: term, mode: 'insensitive' } },
              { section: { contains: term, mode: 'insensitive' } },
            ]),
          }
        : undefined,
      include: {
        AcademyProgress: {
          where: { companyId },
          select: { checked: true, completedAt: true },
        },
      },
      orderBy: { order: 'asc' },
      take: 6,
    });

    return items.map((item) => ({
      title: item.title,
      description: item.description,
      section: item.section,
      page: item.page,
      videoUrl: item.videoUrl,
      files: item.files,
      completed: item.AcademyProgress?.[0]?.checked || false,
    }));
  }

  private getCompanyContext(companyId: string) {
    return this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        name: true,
        legalName: true,
        cnpj: true,
        blockLevel: true,
        isActive: true,
        createdAt: true,
      },
    });
  }

  private success(name: string, content: unknown): AiToolExecutionResult {
    return { name, status: 'success', content };
  }

  private denied(name: string, reason: string): AiToolExecutionResult {
    return { name, status: 'denied', content: { reason } };
  }

  private error(name: string, message: string): AiToolExecutionResult {
    return { name, status: 'error', content: { message } };
  }
}
