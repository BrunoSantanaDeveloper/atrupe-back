import { AiHelpContentService } from './ai-help-content.service';

describe('AiHelpContentService', () => {
  const user = {
    userId: 'user-1',
    companyId: 'company-1',
    role: 'role-1',
    isAdmin: false,
    isSystemAdmin: false,
  };

  function makeService(hasAnyPermission = jest.fn().mockResolvedValue(true)) {
    const academyService = {
      searchHelpContent: jest.fn().mockResolvedValue([]),
    };
    const abacService = { hasAnyPermission };
    const planControlService = {
      hasFeature: jest.fn().mockResolvedValue(true),
    };
    const fiscalOnboardingService = {
      getStatus: jest.fn().mockResolvedValue({
        status: 'ACTIVE',
        hasConfig: true,
        createdAt: new Date('2026-06-01T12:00:00.000Z'),
        errorMessage: 'internal provider error',
        accessKey: 'secret-access-key',
      }),
    };
    const safety = {
      sanitizeText: jest.fn((value) => value),
    };

    return {
      service: new AiHelpContentService(
        academyService as any,
        abacService as any,
        planControlService as any,
        fiscalOnboardingService as any,
        safety as any,
      ),
      academyService,
      abacService,
      planControlService,
      fiscalOnboardingService,
    };
  }

  it('retorna orientacao curada para emissao de nota fiscal', async () => {
    const { service, abacService } = makeService();

    const result = await service.search({ query: 'como emitir nfe' }, user);

    expect(result.processes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'issue_fiscal_document',
          availableForUser: true,
          path: '/nota-fiscal/emitir',
          steps: expect.any(Array),
        }),
      ]),
    );
    expect(abacService.hasAnyPermission).toHaveBeenCalledWith(
      user,
      expect.arrayContaining([
        { action: 'create', resource: 'nota_fiscal:emitir' },
      ]),
    );
  });

  it('nao entrega passos fiscais quando perfil nao possui permissao', async () => {
    const { service } = makeService(jest.fn().mockResolvedValue(false));

    const result = await service.search({ query: 'cancelar nota' }, user);
    const process = (result.processes as any[]).find(
      (item) => item.id === 'cancel_fiscal_document',
    );

    expect(process).toEqual({
      id: 'cancel_fiscal_document',
      title: 'Cancelar uma nota fiscal',
      summary:
        'Solicitar o cancelamento de uma nota autorizada dentro das regras fiscais aplicaveis.',
      availableForUser: false,
      reason: 'Seu perfil nao possui permissao para acessar esse processo.',
    });
    expect(process.steps).toBeUndefined();
    expect(process.path).toBeUndefined();
  });

  it('combina academia com currentPath para ajuda contextual', async () => {
    const { service, academyService } = makeService();
    academyService.searchHelpContent.mockResolvedValue([
      {
        title: 'Ordens de servico',
        description: 'Como acompanhar ordens.',
        section: 'Vendas',
        page: '/vendas/ordens-de-servico',
        videoUrl: 'https://video.example',
        fileCount: 1,
        completed: false,
      },
    ]);

    const result = await service.search(
      {
        query: 'preciso de ajuda',
        currentPath: '/nota-fiscal/emitir?tab=gestao',
      },
      user,
    );

    expect(academyService.searchHelpContent).toHaveBeenCalledWith(
      'preciso de ajuda',
      '/nota-fiscal/emitir?tab=gestao',
      'company-1',
    );
    expect(result.academy).toEqual([
      expect.objectContaining({ title: 'Ordens de servico' }),
    ]);
    expect(result.processes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'manage_fiscal_documents' }),
      ]),
    );
  });

  it('retorna contexto fiscal minimo sem segredos do provedor', async () => {
    const { service, planControlService, fiscalOnboardingService } =
      makeService();

    const result = await service.getFiscalSetupContext(user);

    expect(planControlService.hasFeature).toHaveBeenCalledWith(
      'company-1',
      'nota_fiscal',
    );
    expect(fiscalOnboardingService.getStatus).toHaveBeenCalledWith('company-1');
    expect(result).toEqual({
      moduleAvailable: true,
      onboarding: {
        status: 'ACTIVE',
        hasConfig: true,
        createdAt: new Date('2026-06-01T12:00:00.000Z'),
      },
    });
    expect(result).not.toHaveProperty('accessKey');
    expect(result.onboarding).not.toHaveProperty('errorMessage');
  });
});
