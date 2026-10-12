import { GUARDS_METADATA } from '@nestjs/common/constants';
import { NotFoundException } from '@nestjs/common';
import { ConditionController } from './condition.controller';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { PermissionsGuard } from 'src/core/auth/abac/permissions.guard';
import { HAS_PERMISSION_KEY } from 'src/core/auth/abac/has-permission.decorator';
import { HAS_ANY_PERMISSION_KEY } from 'src/core/auth/abac/has-any-permission.decorator';

const PERMISSION = 'financial_settings:payment_methods';

describe('ConditionController', () => {
  const req = { user: { companyId: 'c-1', userId: 'u-1' } };
  let service: Record<string, jest.Mock>;
  let planControl: { enforceFeature: jest.Mock };
  let prisma: { installment: { findMany: jest.Mock } };
  let controller: ConditionController;

  beforeEach(() => {
    service = {
      create: jest.fn(),
      findInUse: jest.fn(),
      findAvailable: jest.fn(),
      findAll: jest.fn(),
      findDownPayment: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };
    planControl = { enforceFeature: jest.fn() };
    prisma = { installment: { findMany: jest.fn().mockResolvedValue([]) } };
    controller = new ConditionController(
      service as any,
      planControl as any,
      prisma as any,
    );
  });

  const permissionOf = (method: string) =>
    Reflect.getMetadata(
      HAS_PERMISSION_KEY,
      ConditionController.prototype[method],
    );
  const anyPermissionOf = (method: string) =>
    Reflect.getMetadata(
      HAS_ANY_PERMISSION_KEY,
      ConditionController.prototype[method],
    );

  it('a classe inteira passa pelo login e pela permissão', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, ConditionController)).toEqual([
      JwtAuthGuard,
      PermissionsGuard,
    ]);
  });

  it('criar exige create e alterar exige edit', () => {
    expect(permissionOf('create')).toEqual({
      action: 'create',
      resource: PERMISSION,
    });
    expect(permissionOf('update')).toEqual({
      action: 'edit',
      resource: PERMISSION,
    });
  });

  it('desativar aceita edit (o que a tela pede) ou delete', () => {
    expect(permissionOf('remove')).toBeUndefined();
    expect(anyPermissionOf('remove')).toEqual([
      { action: 'edit', resource: PERMISSION },
      { action: 'delete', resource: PERMISSION },
    ]);
  });

  it.each([
    'findInUse',
    'findAvailable',
    'findAll',
    'findDownPayment',
    'findOne',
  ])('%s fica sem permissão: o orçamento e os formulários leem', (method) => {
    expect(permissionOf(method)).toBeUndefined();
    expect(anyPermissionOf(method)).toBeUndefined();
  });

  it('toda rota por id usa a empresa da sessão', async () => {
    const dto: any = { name: 'Cartão', installments: [] };
    await controller.findOne(req, 'pc-1');
    await controller.update(req, 'pc-1', dto);
    await controller.remove(req, 'pc-1');

    expect(service.findOne).toHaveBeenCalledWith('pc-1', 'c-1');
    expect(service.update).toHaveBeenCalledWith('pc-1', 'c-1', dto);
    expect(service.remove).toHaveBeenCalledWith('pc-1', 'c-1');
  });

  it('a condição de outra empresa é recusada antes de ler as parcelas dela', async () => {
    service.findOne.mockRejectedValue(new NotFoundException());
    const dto: any = {
      installments: [{ operatorFeeRate: 2, operatorFeeTransfer: 0 }],
    };

    await expect(controller.update(req, 'pc-9', dto)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.installment.findMany).not.toHaveBeenCalled();
    expect(planControl.enforceFeature).not.toHaveBeenCalled();
    expect(service.update).not.toHaveBeenCalled();
  });
});
