import { GUARDS_METADATA } from '@nestjs/common/constants';
import { CustomersController } from './customers.controller';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { SystemAdminGuard } from '../auth/guards/system-admin.guard';

describe('CustomersController', () => {
  it('é do superadmin: aberto, listava os clientes de cobrança de todas as empresas', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, CustomersController)).toEqual([
      JwtAuthGuard,
      SystemAdminGuard,
    ]);
  });
});
