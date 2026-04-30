import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from 'src/config/prisma/prisma.service';

@Injectable()
export class AbacService {
  constructor(private readonly prisma: PrismaService) {}

  async getPermissionsByRole(role: string): Promise<Partial<Role>> {
    return this.prisma.role.findUnique({
      where: {
        id: role,
      },
      select: {
        permissions: true,
        isAdmin: true,
      },
    });
  }

  async hasPermission(
    user: any,
    action: string,
    resource: string,
  ): Promise<boolean> {
    if (user.isSystemAdmin) return true;
    if (user.isAdmin) return true;

    if (!user.role) return false;

    const roleRecord = await this.prisma.role.findUnique({
      where: { id: user.role },
      select: { permissions: true, isAdmin: true },
    });

    if (!roleRecord) return false;
    if (roleRecord.isAdmin) return true;

    const permissions = roleRecord.permissions || [];

    if (permissions.length === 0) return false;

    return permissions.some((rolePolicy) => {
      // Wildcard: '*' grants all permissions
      if (rolePolicy === '*') return true;

      const parts = rolePolicy.split(':');
      if (parts.length === 2) {
        const [userResource, userAction] = parts;
        return (
          userResource === resource &&
          (userAction === action || userAction === '*')
        );
      } else if (parts.length === 3) {
        const userResource = `${parts[0]}:${parts[1]}`;
        const userAction = parts[2];
        return (
          userResource === resource &&
          (userAction === action || userAction === '*')
        );
      }
      return false;
    });
  }
  /**
   * Verifica se o usuário tem PELO MENOS UMA das permissões listadas (lógica OR).
   * Usado por @HasAnyPermission para suportar recursos com alias (ex: flow ↔ receivable/payable).
   */
  async hasAnyPermission(
    user: any,
    permissions: { action: string; resource: string }[],
  ): Promise<boolean> {
    for (const { action, resource } of permissions) {
      if (await this.hasPermission(user, action, resource)) return true;
    }
    return false;
  }
}
