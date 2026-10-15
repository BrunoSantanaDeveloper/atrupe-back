import { PermissionsGuard } from 'src/core/auth/abac/permissions.guard';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { CashControlController } from './cash-control.controller';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { TenantGuard } from 'src/core/auth/guards/tenant.guard';
import { FeatureGuard } from 'src/core/plan/guards/feature.guard';
import { TENANT_RESOURCE_KEY } from 'src/core/auth/guards/tenant-resource.decorator';

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
