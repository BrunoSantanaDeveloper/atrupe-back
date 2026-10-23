import { PermissionsGuard } from 'src/core/auth/abac/permissions.guard';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { CashControlController } from './cash-control.controller';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { TenantGuard } from 'src/core/auth/guards/tenant.guard';
import { FeatureGuard } from 'src/core/plan/guards/feature.guard';
import { TENANT_RESOURCE_KEY } from 'src/core/auth/guards/tenant-resource.decorator';
import { HAS_PERMISSION_KEY } from 'src/core/auth/abac/has-permission.decorator';
import { OBSERVE_PERMISSIONS_KEY } from 'src/core/auth/abac/observe-permissions.decorator';

const tenantOf = (method: string) =>
  Reflect.getMetadata(
    TENANT_RESOURCE_KEY,
    CashControlController.prototype[method],
  );

describe('CashControlController', () => {
  it('a classe passa pelo login, pelo plano, pela empresa do caixa e pela permissão', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, CashControlController)).toEqual(
      [JwtAuthGuard, FeatureGuard, TenantGuard, PermissionsGuard],
    );
  });

  it.each([
    ['closeCashRegister', 'cashRegisterId'],
    ['editCashRegister', 'cashRegisterId'],
    ['findOneCashRegister', 'id'],
    ['reopenCashRegister', 'id'],
  ])('%s confere a empresa do caixa (:%s)', (method, paramName) => {
    expect(tenantOf(method)).toEqual({
      model: 'cashRegister',
      paramName,
      via: undefined,
    });
  });

  // As rotas antigas ficam para o front de produção, mas recusam: antes, em
  // modo de observação, nem pediam a chave, e reabrir contornava a chave
  // restrita da rota nova (revisão de 23/10/2026)
  it.each([
    ['openCashRegister', 'create', 'financial:cash_control'],
    ['closeCashRegister', 'edit', 'financial:cash_control'],
    ['editCashRegister', 'edit', 'financial:cash_control'],
    ['transferFunds', 'create', 'financial:cash_control'],
    ['reopenCashRegister', 'edit', 'financial:cash_control_reopen'],
    ['reopenDay', 'edit', 'financial:cash_control_reopen'],
  ])('%s recusa sem %s em %s', (method, action, resource) => {
    const handler = CashControlController.prototype[method];
    expect(Reflect.getMetadata(HAS_PERMISSION_KEY, handler)).toEqual({
      action,
      resource,
    });
    expect(Reflect.getMetadata(OBSERVE_PERMISSIONS_KEY, handler)).toBe(false);
  });

  it('a transferência confere as contas com a empresa da sessão', async () => {
    const service = { transferFunds: jest.fn() };
    const controller = new CashControlController(
      service as any,
      {} as any,
      {} as any,
    );
    const dto: any = { sourceBankAccountId: 'a', targetBankAccountId: 'b' };

    await controller.transferFunds({ user: { companyId: 'c-1' } }, dto);
    expect(service.transferFunds).toHaveBeenCalledWith(dto, 'c-1');
  });
});
