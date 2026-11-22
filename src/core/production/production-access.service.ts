import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { AbacService } from '../auth/abac/abac.service';
import { PlanControlService } from '../plan/plan-control.service';

export const PRODUCTION = 'production:production';
export const TIME_ENTRY = 'production:time_entry';
export const PRODUCTIVITY = 'production:productivity';

export const COLLABORATOR_NOT_FOUND = 'Colaborador não encontrado';
export const NO_MANAGER_ACCESS = 'Você não tem acesso a este gerenciador';

/** O usuário da sessão na produção (GP-11), decidido pelo servidor. */
export type ProductionViewer = {
  companyId: string;
  userId: string | null;
  /** O colaborador (Employee) do usuário nesta empresa */
  employeeId: string | null;
  name: string;
  /** Gerente: edita a produção ou tem o perfil MANAGER */
  manager: boolean;
  /** Corrige e lança tempo (GP-44) */
  timeEditor: boolean;
  /** Vê a produtividade por pessoa (PCP-3) */
  productivity: boolean;
  /** O acesso do colaborador a cada gerenciador */
  access: Map<string, { onlyAssigned: boolean }>;
  /**
   * PRO (sem o gerenciador do ELITE): quem vê a produção vê todos os setores
   * (GP-49, 22/11/2026). O acesso por pessoa é do ELITE.
   */
  allSectors?: boolean;
};

/** Quem a tarefa envolve, para a visibilidade do operador com "só o seu". */
export type VisibleTask = {
  managerId: string | null;
  assigneeId: string | null;
  workerIds: string[];
  /** Os colaboradores de antes e de depois das correções (GP-44) */
  affectedIds: string[];
};

/**
 * Quem é quem na produção: o colaborador é o Employee do usuário nesta
 * empresa (um usuário em duas empresas tem dois), nunca o que vem no corpo.
 */
@Injectable()
export class ProductionAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly abac: AbacService,
    private readonly plan: PlanControlService,
  ) {}

  // O usuário da sessão inteiro: a permissão olha o cargo e o administrador
  async viewer(user: {
    userId?: string;
    companyId: string;
    [key: string]: unknown;
  }): Promise<ProductionViewer> {
    const companyId = user.companyId;
    const userId = user.userId ?? null;
    const [employee, editor, timeEntry, productivity, canView, elite] =
      await Promise.all([
        userId
          ? this.prisma.employee.findFirst({
              where: { companyId, userId, isActive: true },
              select: {
                id: true,
                name: true,
                user: { select: { name: true } },
                productionProfile: { select: { role: true } },
                productionManagerUsers: {
                  select: { managerId: true, onlyAssigned: true },
                },
              },
            })
          : null,
        this.abac.hasPermission(user, 'edit', PRODUCTION),
        this.abac.hasPermission(user, 'edit', TIME_ENTRY),
        this.abac.hasPermission(user, 'view', PRODUCTIVITY),
        this.abac.hasPermission(user, 'view', PRODUCTION),
        this.plan.hasFeature(companyId, 'production_manager'),
      ]);
    const userName =
      employee?.name ||
      employee?.user?.name ||
      (userId
        ? (
            await this.prisma.user.findUnique({
              where: { id: userId },
              select: { name: true },
            })
          )?.name
        : null) ||
      'Usuário';
    const manager = editor || employee?.productionProfile?.role === 'MANAGER';
    return {
      companyId,
      userId,
      employeeId: employee?.id ?? null,
      name: userName,
      manager,
      timeEditor: manager || timeEntry,
      // Provisória da tela: quem edita a produção também vê (contrato)
      productivity: productivity || editor,
      allSectors: !elite && (canView || editor),
      access: new Map(
        (employee?.productionManagerUsers ?? []).map((row) => [
          row.managerId,
          { onlyAssigned: row.onlyAssigned },
        ]),
      ),
    };
  }

  /** O operador sem acesso ao gerenciador não abre o quadro dele. */
  assertManagerAccess(viewer: ProductionViewer, managerId: string) {
    if (viewer.manager || viewer.allSectors || viewer.access.has(managerId)) {
      return;
    }
    throw new ForbiddenException(NO_MANAGER_ACCESS);
  }

  /**
   * O gerente vê tudo; o operador, as tarefas dos gerenciadores a que tem
   * acesso, e com "só o seu", as atribuídas a ele, as em que trabalha e as
   * em que uma correção o afetou (GP-11, GP-44).
   */
  canSee(viewer: ProductionViewer, task: VisibleTask) {
    if (viewer.manager || viewer.allSectors) return true;
    if (!viewer.employeeId || !task.managerId) return false;
    const access = viewer.access.get(task.managerId);
    if (!access) return false;
    if (!access.onlyAssigned) return true;
    const me = viewer.employeeId;
    return (
      task.assigneeId === me ||
      task.workerIds.includes(me) ||
      task.affectedIds.includes(me)
    );
  }

  /** Os colaboradores da produção: os usuários ativos da empresa. */
  collaboratorWhere(companyId: string) {
    return {
      companyId,
      isActive: true,
      userId: { not: null },
      user: { isActive: true },
    };
  }

  /** O colaborador ativo da empresa, ou 404 com a mensagem do contrato. */
  async collaborator(companyId: string, employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, ...this.collaboratorWhere(companyId) },
      select: {
        id: true,
        name: true,
        user: { select: { name: true, email: true } },
        productionProfile: { select: { role: true } },
      },
    });
    if (!employee) throw new NotFoundException(COLLABORATOR_NOT_FOUND);
    return {
      id: employee.id,
      name: employee.name || employee.user?.name || '',
      email: employee.user?.email ?? null,
      role: employee.productionProfile?.role ?? 'OPERATOR',
    };
  }
}
