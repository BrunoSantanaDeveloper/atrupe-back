import { Injectable } from '@nestjs/common';
import { AcademyService } from '../academy/academy.service';
import { AbacService } from '../auth/abac/abac.service';
import { FiscalOnboardingService } from '../fiscal/onboarding/fiscal-onboarding.service';
import { PlanControlService } from '../plan/plan-control.service';
import { AiSafetyService } from './ai-safety.service';
import { AiRequestUser } from './ai.types';

type PermissionRequirement = {
  action: string;
  resource: string;
};

interface HelpProcess {
  id: string;
  title: string;
  summary: string;
  keywords: string[];
  paths: string[];
  steps: string[];
  permissions?: PermissionRequirement[];
}

@Injectable()
export class AiHelpContentService {
  private readonly processes: HelpProcess[] = [
    {
      id: 'activate_fiscal_module',
      title: 'Ativar o modulo fiscal',
      summary:
        'Configurar os dados cadastrais e iniciar a ativacao do modulo fiscal da empresa.',
      keywords: [
        'ativar fiscal',
        'configurar modulo fiscal',
        'habilitar nota fiscal',
        'onboarding fiscal',
        'certificado digital',
      ],
      paths: [
        '/configuracoes/empresa-e-sistema',
        '/assinatura/configurar-fiscal',
      ],
      steps: [
        'Acesse Configuracoes > Empresa e sistema.',
        'Abra os dados da empresa e entre na etapa Fiscal.',
        'Selecione Configurar modulo fiscal e informe os dados cadastrais solicitados.',
        'Envie a configuracao e acompanhe o status de ativacao exibido no sistema.',
      ],
    },
    {
      id: 'issue_fiscal_document',
      title: 'Emitir NF-e, NFS-e ou NFC-e',
      summary:
        'Emitir uma nota a partir de uma ordem de servico ou iniciar uma nota avulsa.',
      keywords: [
        'emitir nota',
        'emitir nota fiscal',
        'emitir nfe',
        'emitir nf-e',
        'emitir nfse',
        'emitir nfs-e',
        'emitir nfce',
        'emitir nfc-e',
      ],
      paths: ['/nota-fiscal/emitir'],
      permissions: [
        { action: 'view', resource: 'nota_fiscal:emitir' },
        { action: 'create', resource: 'nota_fiscal:emitir' },
      ],
      steps: [
        'Acesse Nota Fiscal no menu principal.',
        'Escolha uma ordem de servico existente ou selecione a opcao de nota avulsa.',
        'Selecione o tipo de documento: NF-e para produtos, NFS-e para servicos ou NFC-e para venda ao consumidor.',
        'Revise destinatario, itens, dados fiscais e totais antes de confirmar a emissao.',
      ],
    },
    {
      id: 'manage_fiscal_documents',
      title: 'Consultar notas emitidas e em digitacao',
      summary:
        'Acompanhar documentos fiscais autorizados, rascunhos, cancelamentos e rejeicoes.',
      keywords: [
        'consultar nota',
        'notas emitidas',
        'nota em digitacao',
        'nota rejeitada',
        'acompanhar nota',
        'danfe',
      ],
      paths: ['/nota-fiscal/emitir?tab=gestao'],
      permissions: [{ action: 'view', resource: 'nota_fiscal:emitidas' }],
      steps: [
        'Acesse Nota Fiscal no menu principal.',
        'Abra a area de gestao de notas.',
        'Use os filtros para localizar documentos autorizados, em digitacao, cancelados ou rejeitados.',
        'Abra o documento desejado para consultar os dados disponiveis no sistema.',
      ],
    },
    {
      id: 'cancel_fiscal_document',
      title: 'Cancelar uma nota fiscal',
      summary:
        'Solicitar o cancelamento de uma nota autorizada dentro das regras fiscais aplicaveis.',
      keywords: [
        'cancelar nota',
        'cancelar nfe',
        'cancelar nf-e',
        'cancelar nfse',
      ],
      paths: ['/nota-fiscal/emitir?tab=gestao'],
      permissions: [{ action: 'delete', resource: 'nota_fiscal:cancelar' }],
      steps: [
        'Acesse Nota Fiscal e abra a area de gestao.',
        'Localize a nota autorizada que precisa ser cancelada.',
        'Abra as acoes do documento e selecione Cancelar.',
        'Informe a justificativa solicitada e confirme a operacao na tela.',
      ],
    },
    {
      id: 'configure_fiscal_issuer',
      title: 'Configurar emissor, CFOP e natureza de operacao',
      summary:
        'Manter configuracoes fiscais usadas na emissao de documentos da empresa.',
      keywords: [
        'configurar emissor',
        'configurar cfop',
        'natureza de operacao',
        'configuracao nota fiscal',
        'serie nfe',
      ],
      paths: ['/configuracoes/nota-fiscal'],
      permissions: [
        { action: 'view', resource: 'invoice_settings:nf' },
        { action: 'view', resource: 'nota_fiscal:config' },
      ],
      steps: [
        'Acesse Configuracoes > Nota Fiscal.',
        'Abra a configuracao desejada: emissor, CFOP ou natureza de operacao.',
        'Revise os dados fiscais com o apoio da contabilidade da empresa.',
        'Salve as alteracoes pela propria tela de configuracao.',
      ],
    },
    {
      id: 'configure_product_fiscal_data',
      title: 'Configurar dados fiscais de produtos',
      summary:
        'Preencher NCM, CFOP, unidade comercial e tributacao dos produtos usados na nota.',
      keywords: [
        'configurar ncm',
        'produto sem ncm',
        'dados fiscais produto',
        'cfop produto',
        'tributacao produto',
      ],
      paths: ['/configuracoes/produtos'],
      permissions: [
        { action: 'view', resource: 'product_settings:products' },
        { action: 'create', resource: 'nota_fiscal:emitir' },
      ],
      steps: [
        'Acesse Configuracoes > Produtos.',
        'Abra o produto desejado e entre na aba Fiscal.',
        'Preencha os dados fiscais conforme a orientacao da contabilidade.',
        'Salve o produto e retorne a emissao da nota.',
      ],
    },
  ];

  constructor(
    private readonly academyService: AcademyService,
    private readonly abacService: AbacService,
    private readonly planControlService: PlanControlService,
    private readonly fiscalOnboardingService: FiscalOnboardingService,
    private readonly safety: AiSafetyService,
  ) {}

  async search(
    args: Record<string, unknown>,
    user: AiRequestUser,
  ): Promise<Record<string, unknown>> {
    const query = String(args.query || '').trim();
    const currentPath = String(args.currentPath || '').trim();
    const academyItems = await this.academyService.searchHelpContent(
      query,
      currentPath,
      user.companyId,
    );
    const matchedProcesses = await Promise.all(
      this.processes
        .map((process) => ({
          process,
          score: this.getMatchScore(process, query, currentPath),
        }))
        .filter(({ score }) => score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, 4)
        .map(async ({ process }) => this.formatProcess(process, user)),
    );

    return {
      query,
      currentPath: currentPath || null,
      processes: matchedProcesses,
      academy: academyItems.map((item) => ({
        title: this.safety.sanitizeText(item.title, 160),
        description: this.safety.sanitizeText(item.description, 500),
        section: this.safety.sanitizeText(item.section, 120),
        page: this.safety.sanitizeText(item.page, 200),
        videoUrl: item.videoUrl,
        fileCount: item.fileCount,
        completed: item.completed,
      })),
    };
  }

  async getFiscalSetupContext(user: AiRequestUser) {
    const [moduleAvailable, onboarding] = await Promise.all([
      this.planControlService.hasFeature(user.companyId, 'nota_fiscal'),
      this.fiscalOnboardingService.getStatus(user.companyId),
    ]);

    return {
      moduleAvailable,
      onboarding: {
        status: onboarding.status,
        hasConfig: onboarding.hasConfig,
        createdAt: onboarding.createdAt || null,
      },
    };
  }

  private async formatProcess(process: HelpProcess, user: AiRequestUser) {
    const allowed = await this.hasAnyPermission(user, process.permissions);
    return {
      id: process.id,
      title: process.title,
      summary: process.summary,
      availableForUser: allowed,
      ...(allowed
        ? {
            path: process.paths[0],
            steps: process.steps,
          }
        : {
            reason:
              'Seu perfil nao possui permissao para acessar esse processo.',
          }),
    };
  }

  private async hasAnyPermission(
    user: AiRequestUser,
    permissions?: PermissionRequirement[],
  ) {
    if (!permissions?.length) return true;
    return this.abacService.hasAnyPermission(user, permissions);
  }

  private getMatchScore(
    process: HelpProcess,
    query: string,
    currentPath: string,
  ) {
    const normalizedQuery = this.normalize(query);
    const normalizedPath = this.normalize(currentPath);
    let score = 0;

    if (
      normalizedPath &&
      process.paths.some((path) =>
        normalizedPath.includes(this.normalize(path)),
      )
    ) {
      score += 4;
    }

    for (const keyword of process.keywords) {
      const normalizedKeyword = this.normalize(keyword);
      if (
        normalizedQuery.includes(normalizedKeyword) ||
        normalizedKeyword.includes(normalizedQuery)
      ) {
        score += 2;
      }
    }

    if (
      normalizedQuery &&
      this.normalize(`${process.title} ${process.summary}`).includes(
        normalizedQuery,
      )
    ) {
      score += 1;
    }

    return score;
  }

  private normalize(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }
}
