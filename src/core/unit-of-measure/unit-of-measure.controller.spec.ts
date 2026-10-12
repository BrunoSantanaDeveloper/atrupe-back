import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UnitOfMeasureController } from './unit-of-measure.controller';
import { SystemAdminGuard } from '../auth/guards/system-admin.guard';

const guardsOf = (method: string) =>
  Reflect.getMetadata(
    GUARDS_METADATA,
    UnitOfMeasureController.prototype[method],
  ) ?? [];

describe('UnitOfMeasureController', () => {
  it.each(['create', 'update', 'remove'])(
    '%s escreve na unidade padrão de todas as empresas: só o superadmin',
    (method) => {
      expect(guardsOf(method)).toContain(SystemAdminGuard);
    },
  );
});
