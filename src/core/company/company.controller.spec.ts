import { NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { CompanyController } from './company.controller';
import { SystemAdminGuard } from '../auth/guards/system-admin.guard';
import {
  FeatureGuard,
  REQUIRED_FEATURE_KEY,
} from '../plan/guards/feature.guard';

/**
 * Criar outra empresa na mesma conta é recurso de plano. A empresa principal,
 * criada no cadastro, nunca pode depender de plano: a conta ainda está
 * nascendo.
 */
describe('CompanyController — recurso de plano', () => {
  const handlerMetadata = (key: string, handler: 'create' | 'createMain') =>
    Reflect.getMetadata(key, CompanyController.prototype[handler]);

  it('POST /company (outra empresa) exige multiple_companies', () => {
    expect(handlerMetadata(REQUIRED_FEATURE_KEY, 'create')).toBe(
      'multiple_companies',
    );
    expect(handlerMetadata(GUARDS_METADATA, 'create')).toEqual([FeatureGuard]);
  });

  it('POST /company/main (cadastro) não confere plano', () => {
    expect(handlerMetadata(REQUIRED_FEATURE_KEY, 'createMain')).toBeUndefined();
    expect(handlerMetadata(GUARDS_METADATA, 'createMain')).toBeUndefined();
    expect(
      Reflect.getMetadata(REQUIRED_FEATURE_KEY, CompanyController),
    ).toBeUndefined();
  });
});

/**
 * As rotas por id só valem para as empresas da conta (a da sessão e as
 * filiais). Antes, qualquer usuário logado lia, alterava e inativava a
 * empresa de outro cliente.
 */
describe('CompanyController — empresas da conta', () => {
  const service = {
    assertInAccount: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };
  const controller = new CompanyController(service as any);
  const req = { user: { companyId: 'empresa-a', isSystemAdmin: false } };

  beforeEach(() => {
    jest.clearAllMocks();
    service.assertInAccount.mockRejectedValue(
      new NotFoundException('Empresa não encontrada.'),
    );
  });

  const cases: [
    string,
    'findOne' | 'update' | 'remove',
    () => Promise<unknown>,
  ][] = [
    ['GET /company/:id', 'findOne', () => controller.findOne('empresa-b', req)],
    [
      'PATCH /company/:id',
      'update',
      () => controller.update('empresa-b', {} as any, req),
    ],
    [
      'DELETE /company/:id',
      'remove',
      () => controller.remove('empresa-b', req),
    ],
  ];

  it.each(cases)(
    '%s de outra conta: 404 sem tocar na empresa',
    async (_label, action, call) => {
      await expect(call()).rejects.toBeInstanceOf(NotFoundException);
      expect(service.assertInAccount).toHaveBeenCalledWith(
        'empresa-b',
        req.user,
      );
      expect(service[action]).not.toHaveBeenCalled();
    },
  );

  it('histórico e itens padrão de qualquer empresa só para o superadmin', () => {
    for (const handler of [
      'listHistory',
      'createHistory',
      'createMissingDefaultItems',
    ] as const) {
      expect(
        Reflect.getMetadata(
          GUARDS_METADATA,
          CompanyController.prototype[handler],
        ),
      ).toEqual([SystemAdminGuard]);
    }
  });
});
