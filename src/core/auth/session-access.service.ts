import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from 'src/config/prisma/prisma.service';

/** Por quanto tempo um vínculo conferido dispensa nova consulta. */
const LINK_TTL_MS = 10_000;
/** Teto do cache: passando dele, recomeça vazio (só custa consultas). */
const MAX_ENTRIES = 10_000;

export interface SessionClaims {
  sub?: string;
  companyId?: string | null;
  employeeId?: string | null;
}

/**
 * Confere, a cada requisição, se o token ainda alcança a empresa que cita.
 *
 * Os tokens são JWT sem estado e valem 4 horas: sem esta conferência, quem
 * transferiu o ambiente seguiria entrando nele até o token vencer. O que o
 * token cita — este usuário, por este colaborador, nesta empresa — é
 * conferido no banco. A transferência desfaz o vínculo (Employee.userId =
 * null), e a sessão de quem saiu cai na requisição seguinte.
 *
 * O vínculo conferido fica em cache por alguns segundos, para não somar uma
 * consulta a cada requisição de quem está trabalhando; `forgetUser` o descarta
 * no instante em que a transferência é efetivada.
 */
@Injectable()
export class SessionAccessService {
  private readonly linkedAt = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  async assertLinked(claims: SessionClaims): Promise<void> {
    // Administrador do sistema, e token sem colaborador, não citam vínculo.
    if (!claims?.sub || !claims.companyId || !claims.employeeId) return;

    const key = this.keyOf(claims.sub, claims.employeeId, claims.companyId);
    const at = this.linkedAt.get(key);
    if (at !== undefined && Date.now() - at < LINK_TTL_MS) return;

    const employee = await this.prisma.employee.findUnique({
      where: { id: claims.employeeId },
      select: { userId: true, companyId: true },
    });
    if (
      !employee ||
      employee.userId !== claims.sub ||
      employee.companyId !== claims.companyId
    ) {
      this.linkedAt.delete(key);
      throw new UnauthorizedException({
        code: 'SESSION_REVOKED',
        message:
          'Esta sessão não dá mais acesso a esta empresa. Entre novamente.',
      });
    }

    if (this.linkedAt.size >= MAX_ENTRIES) this.linkedAt.clear();
    this.linkedAt.set(key, Date.now());
  }

  /**
   * A transferência que tirou o acesso deste login, se foi isso que o tirou.
   *
   * Quem transferiu o ambiente deve saber por que não entra ("Saída de quem
   * transferiu"), e não receber o mesmo "dados inválidos" de uma senha
   * errada. Só com a senha certa: o motivo não é contado a quem não é o dono
   * da conta.
   */
  async transferredAccess(
    email: string,
    password: string,
  ): Promise<{ companyName: string; acceptedAt: Date } | null> {
    const user = await this.prisma.user.findFirst({
      where: {
        email: { equals: email.trim(), mode: 'insensitive' },
        isActive: false,
      },
      select: { id: true, password: true },
    });
    if (!user || !(await argon2.verify(user.password, password))) return null;

    const transfer = await this.prisma.ownershipTransfer.findFirst({
      where: { fromUserId: user.id, status: 'ACCEPTED' },
      orderBy: { acceptedAt: 'desc' },
      select: { companyName: true, acceptedAt: true },
    });
    return transfer?.acceptedAt
      ? { companyName: transfer.companyName, acceptedAt: transfer.acceptedAt }
      : null;
  }

  /** Esquece os vínculos conferidos de um usuário: a próxima requisição consulta. */
  forgetUser(userId: string): void {
    const prefix = `${userId}|`;
    for (const key of this.linkedAt.keys()) {
      if (key.startsWith(prefix)) this.linkedAt.delete(key);
    }
  }

  private keyOf(userId: string, employeeId: string, companyId: string) {
    return `${userId}|${employeeId}|${companyId}`;
  }
}
