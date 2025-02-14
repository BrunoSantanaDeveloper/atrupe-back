import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from 'src/config/prisma/prisma.service';

import { UserService } from 'src/core/user/user.service';

@Injectable()
export class AbacService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
  ) {}

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
    user: { userId: string; username: string },
    action: string,
    resource: string,
  ): Promise<boolean> {
    const userWithRoles = await this.userService.findOneRoles(user.userId);

    if (!userWithRoles) return false;

    return userWithRoles.userRole.some((userRole) => {
      return userRole.role.permissions.some((rolePolicy) => {
        const [userResource, userActions] = rolePolicy.split(':');
        return userResource === resource && userActions.includes(action);
      });
    });
  }
}
