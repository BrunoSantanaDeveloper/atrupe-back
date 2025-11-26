import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';

@Injectable()
export class SystemAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Usuário não autenticado');
    }

    if (!user.isSystemAdmin) {
      throw new ForbiddenException(
        'Acesso negado. Apenas administradores do sistema podem acessar este recurso.',
      );
    }

    return true;
  }
}
