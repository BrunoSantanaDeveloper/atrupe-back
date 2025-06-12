import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/config/prisma/prisma.service';
import {
  AcademyResponse,
  AcademySection,
  AcademyItem,
  PlanType,
  PLAN_HIERARCHY,
} from './interfaces/academy.interface';
import { UpdateProgressDto } from './dto/update-progress.dto';

@Injectable()
export class AcademyService {
  // Armazenamento temporário em memória para progresso do usuário
  // TODO: Remover quando a tabela academy_progress estiver criada
  private temporaryProgress = new Map<string, Map<string, boolean>>();

  constructor(private readonly prisma: PrismaService) {}

  async getAcademyByPlan(
    plan: string,
    userId: string,
    companyId: string,
  ): Promise<AcademyResponse> {
    // Validar se o plano é válido
    const requestedPlan = plan.toLowerCase() as PlanType;
    if (!Object.values(PlanType).includes(requestedPlan)) {
      throw new BadRequestException('Plano inválido');
    }

    // Verificar se o usuário tem acesso ao plano solicitado
    await this.validatePlanAccess(requestedPlan, companyId);

    // Obter progresso do usuário
    const userProgress = await this.getUserProgress(userId, companyId);

    // Gerar estrutura da academy para o plano
    const academyData = this.generateAcademyStructure(requestedPlan);

    // Aplicar progresso do usuário
    const sectionsWithProgress = this.applyUserProgress(
      academyData.sections,
      userProgress,
    );

    return {
      plan: requestedPlan,
      sections: sectionsWithProgress,
    };
  }

  async updateProgress(
    userId: string,
    companyId: string,
    plan: string,
    updateProgressDto: UpdateProgressDto,
  ): Promise<{ success: boolean; message: string }> {
    const { itemId, checked } = updateProgressDto;

    // Verificar se o item existe no plano
    const planType = plan.toLowerCase() as PlanType;
    const academyStructure = this.generateAcademyStructure(planType);
    const itemExists = this.itemExistsInPlan(itemId, academyStructure.sections);

    if (!itemExists) {
      throw new NotFoundException('Item não encontrado no plano especificado');
    }

    try {
      // TODO: Implementar quando a tabela academy_progress estiver criada
      // Por enquanto, usar armazenamento temporário em memória

      const userKey = `${userId}_${companyId}`;
      if (!this.temporaryProgress.has(userKey)) {
        this.temporaryProgress.set(userKey, new Map<string, boolean>());
      }

      const userProgressMap = this.temporaryProgress.get(userKey)!;

      if (checked) {
        userProgressMap.set(itemId, true);
      } else {
        userProgressMap.delete(itemId);
      }

      return {
        success: true,
        message: checked ? 'Item marcado como concluído' : 'Item desmarcado',
      };

      // Código futuro quando a tabela estiver criada:
      /*
      if (checked) {
        // Marcar como concluído
        await this.prisma.academyProgress.upsert({
          where: {
            userId_companyId_itemId: {
              userId,
              companyId,
              itemId,
            },
          },
          update: {
            checked: true,
            completedAt: new Date(),
          },
          create: {
            userId,
            companyId,
            plan: planType,
            itemId,
            checked: true,
            completedAt: new Date(),
          },
        });
      } else {
        // Desmarcar
        await this.prisma.academyProgress.deleteMany({
          where: {
            userId,
            companyId,
            itemId,
          },
        });
      }
      */
    } catch (error) {
      throw new BadRequestException(
        'Erro ao atualizar progresso: ' + error.message,
      );
    }
  }

  private async validatePlanAccess(
    requestedPlan: PlanType,
    companyId: string,
  ): Promise<void> {
    // Buscar o plano contratado pela empresa
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        companyId,
        isActive: true,
      },
      include: {
        plan: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!subscription || !subscription.plan) {
      throw new ForbiddenException('Empresa não possui plano ativo');
    }

    const contractedPlanType = subscription.plan.type.toLowerCase() as PlanType;
    const contractedPlanLevel = PLAN_HIERARCHY[contractedPlanType];
    const requestedPlanLevel = PLAN_HIERARCHY[requestedPlan];

    if (requestedPlanLevel > contractedPlanLevel) {
      throw new ForbiddenException(
        `Acesso negado. Plano contratado: ${contractedPlanType.toUpperCase()}, Plano solicitado: ${requestedPlan.toUpperCase()}`,
      );
    }
  }

  private async getUserProgress(
    userId: string,
    companyId: string,
  ): Promise<Map<string, boolean>> {
    // TODO: Implementar quando a tabela academy_progress estiver criada
    // Por enquanto, usar armazenamento temporário em memória

    const userKey = `${userId}_${companyId}`;
    if (!this.temporaryProgress.has(userKey)) {
      this.temporaryProgress.set(userKey, new Map<string, boolean>());
    }

    return this.temporaryProgress.get(userKey)!;

    // Código futuro quando a tabela estiver criada:
    /*
    const progressRecords = await this.prisma.academyProgress.findMany({
      where: {
        userId,
        companyId,
        checked: true,
      },
    });

    const progressMap = new Map<string, boolean>();
    progressRecords.forEach(record => {
      progressMap.set(record.itemId, record.checked);
    });

    return progressMap;
    */
  }

  private generateAcademyStructure(plan: PlanType): {
    sections: AcademySection[];
  } {
    const sections: AcademySection[] = [];

    // Seção Apresentação (todos os planos)
    sections.push({
      id: 'apresentacao',
      title: 'Apresentação',
      items: [
        {
          id: 'apresentacao-' + plan,
          description: `Apresentação do ${plan.toUpperCase()}`,
          checked: false,
          files: [
            {
              title: 'Manual de Apresentação',
              type: 'pdf',
              src: `https://docs.atrupe.com.br/${plan}/apresentacao.pdf`,
            },
          ],
          video: '495579294',
          page: `/academy/${plan}`,
          buttonTitle: 'Acessar apresentação',
        },
      ],
    });

    // Seção Configurações (todos os planos)
    const configItems: AcademyItem[] = [
      {
        id: 'cadastro-empresa',
        description: 'Cadastre os dados da sua empresa',
        checked: true,
        video: '495579294',
        modal: 'CompanyInfo',
        buttonTitle: 'Cadastrar dados',
      },
      {
        id: 'configuracao-setores',
        description: 'Configure os setores da empresa',
        checked: false,
        video: '495579295',
        page: '/configuracoes/empresa-e-sistema/setores',
        buttonTitle: 'Informar os setores',
      },
      {
        id: 'configuracao-medidas',
        description: 'Configure as unidades de medida',
        checked: false,
        video: '495579296',
        modal: 'MeasureStandards',
        buttonTitle: 'Definir padrões',
      },
      {
        id: 'cadastro-colaboradores',
        description: 'Cadastre os colaboradores',
        checked: false,
        video: '495579297',
        page: '/configuracoes/empresa-e-sistema/colaboradores-e-usuarios',
        buttonTitle: 'Cadastrar colaboradores',
      },
      {
        id: 'cadastro-produtos',
        description: 'Cadastre seus produtos',
        checked: false,
        video: '495579298',
        page: '/configuracoes/produtos',
        buttonTitle: 'Cadastrar produtos',
      },
    ];

    sections.push({
      id: 'configuracoes',
      title: 'Configurações',
      items: configItems,
    });

    // Seções adicionais baseadas no plano
    if (PLAN_HIERARCHY[plan] >= PLAN_HIERARCHY[PlanType.LITE]) {
      sections.push({
        id: 'cadastros-basicos',
        title: 'Cadastros Básicos',
        items: [
          {
            id: 'cadastro-clientes',
            description: 'Cadastre seus clientes',
            checked: false,
            video: '495579299',
            page: '/cadastros/clientes',
            buttonTitle: 'Cadastrar cliente',
          },
          {
            id: 'cadastro-fornecedores',
            description: 'Cadastre seus fornecedores',
            checked: false,
            video: '495579300',
            page: '/cadastros/fornecedores',
            buttonTitle: 'Cadastrar fornecedor',
          },
        ],
      });
    }

    if (PLAN_HIERARCHY[plan] >= PLAN_HIERARCHY[PlanType.PRO]) {
      sections.push(
        {
          id: 'vendas',
          title: 'Vendas',
          items: [
            {
              id: 'primeira-venda',
              description: 'Realize sua primeira venda',
              checked: false,
              video: '495579301',
              page: '/vendas/nova',
              buttonTitle: 'Realizar venda',
            },
            {
              id: 'gestao-orcamentos',
              description: 'Gerencie seus orçamentos',
              checked: false,
              video: '495579302',
              page: '/vendas/orcamentos',
              buttonTitle: 'Gerenciar orçamentos',
            },
          ],
        },
        {
          id: 'estoque',
          title: 'Estoque',
          items: [
            {
              id: 'controle-estoque',
              description: 'Configure o controle de estoque',
              checked: false,
              video: '495579303',
              page: '/estoque/configuracoes',
              buttonTitle: 'Configurar estoque',
            },
            {
              id: 'movimentacao-estoque',
              description: 'Aprenda sobre movimentações',
              checked: false,
              files: [
                {
                  title: 'Manual de Movimentações',
                  type: 'pdf',
                  src: 'https://docs.atrupe.com.br/estoque/movimentacoes.pdf',
                },
              ],
              video: '495579304',
              buttonTitle: 'Ver movimentações',
            },
          ],
        },
      );
    }

    if (PLAN_HIERARCHY[plan] >= PLAN_HIERARCHY[PlanType.ELITE]) {
      sections.push(
        {
          id: 'financeiro',
          title: 'Financeiro',
          items: [
            {
              id: 'fluxo-caixa',
              description: 'Configure o fluxo de caixa',
              checked: false,
              video: '495579305',
              page: '/financeiro/fluxo-caixa',
              buttonTitle: 'Configurar fluxo de caixa',
            },
            {
              id: 'contas-pagar',
              description: 'Gerencie contas a pagar',
              checked: false,
              video: '495579306',
              page: '/financeiro/contas-pagar',
              buttonTitle: 'Gerenciar contas a pagar',
            },
            {
              id: 'contas-receber',
              description: 'Gerencie contas a receber',
              checked: false,
              video: '495579307',
              page: '/financeiro/contas-receber',
              buttonTitle: 'Gerenciar contas a receber',
            },
          ],
        },
        {
          id: 'relatorios',
          title: 'Relatórios',
          items: [
            {
              id: 'relatorios-vendas',
              description: 'Relatórios de vendas',
              checked: false,
              video: '495579308',
              page: '/relatorios/vendas',
              buttonTitle: 'Ver relatórios de vendas',
            },
            {
              id: 'relatorios-financeiros',
              description: 'Relatórios financeiros',
              checked: false,
              files: [
                {
                  title: 'Guia de Relatórios Financeiros',
                  type: 'pdf',
                  src: 'https://docs.atrupe.com.br/relatorios/financeiros.pdf',
                },
              ],
              page: '/relatorios/financeiro',
              buttonTitle: 'Ver relatórios financeiros',
            },
          ],
        },
      );
    }

    if (PLAN_HIERARCHY[plan] >= PLAN_HIERARCHY[PlanType.FULL]) {
      sections.push(
        {
          id: 'automacoes',
          title: 'Automações',
          items: [
            {
              id: 'workflow-vendas',
              description: 'Configure workflows de vendas',
              checked: false,
              files: [
                {
                  title: 'Manual de Workflows',
                  type: 'pdf',
                  src: 'https://docs.atrupe.com.br/workflows/vendas.pdf',
                },
              ],
              modal: 'WorkflowConfig',
              buttonTitle: 'Configurar workflows',
            },
            {
              id: 'automacao-estoque',
              description: 'Automações de estoque',
              checked: false,
              video: '495579309',
              modal: 'StockAutomation',
              buttonTitle: 'Configurar automações',
            },
          ],
        },
        {
          id: 'integracoes',
          title: 'Integrações',
          items: [
            {
              id: 'api-configuracao',
              description: 'Configure APIs externas',
              checked: false,
              files: [
                {
                  title: 'Documentação de APIs',
                  type: 'pdf',
                  src: 'https://docs.atrupe.com.br/api/configuracao.pdf',
                },
              ],
              page: '/configuracoes/integracoes',
              buttonTitle: 'Configurar integrações',
            },
            {
              id: 'sincronizacoes',
              description: 'Configure sincronizações',
              checked: false,
              video: '495579310',
              modal: 'SyncConfig',
              buttonTitle: 'Configurar sincronizações',
            },
          ],
        },
      );
    }

    return { sections };
  }

  private applyUserProgress(
    sections: AcademySection[],
    userProgress: Map<string, boolean>,
  ): AcademySection[] {
    return sections.map((section) => ({
      ...section,
      items: section.items.map((item) => ({
        ...item,
        checked: userProgress.get(item.id) || false,
      })),
    }));
  }

  private itemExistsInPlan(
    itemId: string,
    sections: AcademySection[],
  ): boolean {
    return sections.some((section) =>
      section.items.some((item) => item.id === itemId),
    );
  }
}
