import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHmac } from 'crypto';
import { PrismaService } from 'src/config/prisma/prisma.service';

/** Por quanto tempo um vínculo conferido dispensa nova consulta. */
const LINK_TTL_MS = 10_000;
/** Teto do cache: passando dele, recomeça vazio (só custa consultas). */
const MAX_ENTRIES = 10_000;

export interface SessionClaims {
  sub?: string;
  companyId?: string | null;
  employeeId?: string | null;
  /** Impressão da senha gravada quando o token foi emitido (passwordStamp). */
  pwd?: string;
}

const linkRevoked = () =>
  new UnauthorizedException({
    code: 'SESSION_REVOKED',
    message: 'Esta sessão não dá mais acesso a esta empresa. Entre novamente.',
  });

const sessionEnded = () =>
  new UnauthorizedException({
    code: 'SESSION_REVOKED',
    message: 'Sua sessão foi encerrada. Entre novamente.',
  });

/**
 * Confere, a cada requisição, se o token ainda alcança a empresa que cita.
 *
 * Os tokens são JWT sem estado e valem 4 horas: sem esta conferência, quem
 * transferiu o ambiente seguiria entrando nele até o token vencer. O que o
 * token cita — este usuário, por este colaborador, nesta empresa — é
 * conferido no banco. A transferência desfaz o vínculo (Employee.userId =
 * null), e a sessão de quem saiu cai na requisição seguinte. Do mesmo jeito,
 * a sessão de quem foi inativado (inativar o colaborador inativa o usuário).
 *
 * O vínculo conferido fica em cache por alguns segundos, para não somar uma
 * consulta a cada requisição de quem está trabalhando; `forgetUser` o descarta
 * no instante em que a transferência é efetivada.
 */
@Injectable()
export class SessionAccessService {
  private readonly linkedAt = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Impressão da senha gravada, que vai no token. O hash da senha tem sal,
   * então muda a cada troca, mesmo para a mesma senha: o token emitido antes
   * da troca deixa de bater. É um HMAC com o segredo do refresh: não revela
   * nada do hash.
   */
  passwordStamp(passwordHash: string): string {
    // O segredo é lido aqui, e não pelo import de constants.ts, que recusa
    // carregar sem ele: este serviço é importado por specs que não o definem.
    // Na API, constants.ts já garante o segredo desde a subida.
    const secret = process.env.JWT_REFRESH_SECRET;
    if (!secret) {
      throw new Error(
        'JWT_REFRESH_SECRET environment variable must be defined',
      );
    }
    return createHmac('sha256', secret)
      .update(passwordHash)
      .digest('base64url')
      .slice(0, 22);
  }

  async assertLinked(claims: SessionClaims): Promise<void> {
    // Administrador do sistema, e token sem colaborador, não citam vínculo.
    if (!claims?.sub || !claims.companyId || !claims.employeeId) return;

    const key = this.keyOf(claims.sub, claims.employeeId, claims.companyId);
    const at = this.linkedAt.get(key);
    if (at !== undefined && Date.now() - at < LINK_TTL_MS) return;

    const employee = await this.prisma.employee.findUnique({
      where: { id: claims.employeeId },
      select: {
        userId: true,
        companyId: true,
        user: { select: { isActive: true } },
      },
    });
    if (
      !employee ||
      employee.userId !== claims.sub ||
      employee.companyId !== claims.companyId
    ) {
      this.linkedAt.delete(key);
      throw linkRevoked();
    }
    if (!employee.user?.isActive) {
      this.linkedAt.delete(key);
      throw sessionEnded();
    }

    if (this.linkedAt.size >= MAX_ENTRIES) this.linkedAt.clear();
    this.linkedAt.set(key, Date.now());
  }

  /**
   * Confere, na renovação, se a sessão ainda vale, e devolve a impressão da
   * senha para os tokens novos.
   *
   * O refresh token vale 30 dias e cada renovação emite outro: sem esta
   * conferência, trocar a senha ou inativar o usuário não encerrava a sessão
   * de quem tinha um. Recusa usuário inativo, senha trocada depois da
   * emissão, e token sem a impressão (emitido antes desta conferência: o
   * front não usa o refresh, então ninguém perde a sessão no deploy). O
   * vínculo com a empresa é o mesmo do token de acesso.
   */
  async assertRefreshable(claims: SessionClaims): Promise<string> {
    if (!claims?.sub) throw sessionEnded();

    const user = await this.prisma.user.findUnique({
      where: { id: claims.sub },
      select: { isActive: true, password: true },
    });
    if (!user?.isActive) throw sessionEnded();

    const stamp = this.passwordStamp(user.password);
    if (!claims.pwd || claims.pwd !== stamp) throw sessionEnded();

    await this.assertLinked(claims);
    return stamp;
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
