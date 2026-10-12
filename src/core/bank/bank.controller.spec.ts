import { PermissionsGuard } from 'src/core/auth/abac/permissions.guard';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { BankController } from './bank.controller';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { SystemAdminGuard } from '../auth/guards/system-admin.guard';

const guardsOf = (method: string) =>
  Reflect.getMetadata(GUARDS_METADATA, BankController.prototype[method]) ?? [];

describe('BankController', () => {
  it('a classe passa pelo login, pela empresa da conta e pela permissão', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, BankController)).toEqual([
      JwtAuthGuard,
      TenantGuard,
      PermissionsGuard,
    ]);
  });

  it.each(['create', 'update', 'remove'])(
    '%s escreve no cadastro de bancos de todas as empresas: só o superadmin',
    (method) => {
      expect(guardsOf(method)).toContain(SystemAdminGuard);
    },
  );

  it.each(['findAll', 'createAccount', 'listAccounts', 'updateAccount'])(
    '%s não é do superadmin',
    (method) => {
      expect(guardsOf(method)).not.toContain(SystemAdminGuard);
    },
  );
});
