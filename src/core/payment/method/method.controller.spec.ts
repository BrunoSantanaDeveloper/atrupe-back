import { GUARDS_METADATA } from '@nestjs/common/constants';
import { MethodController } from './method.controller';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { SystemAdminGuard } from 'src/core/auth/guards/system-admin.guard';
import { PermissionsGuard } from 'src/core/auth/abac/permissions.guard';
import { HAS_PERMISSION_KEY } from 'src/core/auth/abac/has-permission.decorator';
import { HAS_ANY_PERMISSION_KEY } from 'src/core/auth/abac/has-any-permission.decorator';

const CONDITIONS_PERMISSION = 'financial_settings:payment_methods';

describe('MethodController', () => {
  const guardsOf = (method: string) =>
    Reflect.getMetadata(GUARDS_METADATA, MethodController.prototype[method]);

  it('a classe inteira passa pelo login e pela permissão', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, MethodController)).toEqual([
      JwtAuthGuard,
      PermissionsGuard,
    ]);
  });

  it('criar aceita quem cria ou edita condição de pagamento', () => {
    expect(
      Reflect.getMetadata(
        HAS_ANY_PERMISSION_KEY,
        MethodController.prototype.create,
      ),
    ).toEqual([
      { action: 'create', resource: CONDITIONS_PERMISSION },
      { action: 'edit', resource: CONDITIONS_PERMISSION },
    ]);
  });

  it.each(['update', 'remove'])(
    '%s muda a forma de todas as empresas: só o superadmin',
    (method) => {
      expect(guardsOf(method)).toEqual([SystemAdminGuard]);
    },
  );

  it.each(['findAll', 'findOne'])(
    '%s fica aberta a quem está logado',
    (method) => {
      expect(guardsOf(method)).toBeUndefined();
      expect(
        Reflect.getMetadata(
          HAS_PERMISSION_KEY,
          MethodController.prototype[method],
        ),
      ).toBeUndefined();
      expect(
        Reflect.getMetadata(
          HAS_ANY_PERMISSION_KEY,
          MethodController.prototype[method],
        ),
      ).toBeUndefined();
    },
  );
});
