import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from 'src/config/prisma/prisma.service';

/**
 * Decorator para marcar rotas que requerem empresa não bloqueada
 * Usado para rotas que devem ser bloqueadas quando a empresa está com PARTIAL block
 */
export const REQUIRE_UNBLOCKED_KEY = 'requireUnblocked';
export const RequireUnblocked = () => SetMetadata(REQUIRE_UNBLOCKED_KEY, true);

/**
 * Guard que verifica se a empresa do usuário está bloqueada
 * Bloqueia totalmente se FULL, bloqueia rotas marcadas com @RequireUnblocked() se PARTIAL
 */
@Injectable()
export class BlockLevelGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Se não há usuário autenticado, deixa passar (outro guard vai tratar)
    if (!user || !user.companyId) {
      return true;
    }

    // Verificar se usuário é system admin (admins do sistema não são bloqueados)
    if (user.isSystemAdmin) {
      return true;
    }

    // Buscar status de bloqueio da empresa
    const company = await this.prisma.company.findUnique({
      where: { id: user.companyId },
      select: { blockLevel: true, blockReason: true },
    });

    if (!company) {
      return true; // Empresa não encontrada, deixa outro middleware tratar
    }

    // Bloqueio FULL: bloqueia tudo
    if (company.blockLevel === 'FULL') {
      throw new ForbiddenException({
        code: 'COMPANY_BLOCKED_FULL',
        message:
          'Empresa bloqueada por inadimplência. Regularize sua situação para continuar.',
        blockLevel: 'FULL',
        blockReason: company.blockReason,
      });
    }

    // Bloqueio PARTIAL: verifica se a rota requer empresa desbloqueada
    if (company.blockLevel === 'PARTIAL') {
      const requireUnblocked = this.reflector.getAllAndOverride<boolean>(
        REQUIRE_UNBLOCKED_KEY,
        [context.getHandler(), context.getClass()],
      );

      if (requireUnblocked) {
        throw new ForbiddenException({
          code: 'FEATURE_BLOCKED',
          message:
            'Esta funcionalidade está bloqueada devido à inadimplência. Regularize sua situação.',
          blockLevel: 'PARTIAL',
          blockReason: company.blockReason,
        });
      }

      // Anexar blockLevel ao request para middleware/controllers usarem se necessário
      request.blockLevel = 'PARTIAL';
    }

    return true;
  }
}
