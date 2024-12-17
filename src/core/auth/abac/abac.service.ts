import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/config/prisma/prisma.service';

import { UserService } from 'src/core/user/user.service';

@Injectable()
export class AbacService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
  ) {}

  async hasPermission(
    user: { userId: string; username: string },
    action: string,
    resource: string,
  ): Promise<boolean> {
    const userWithRoles = await this.userService.findOneRoles(user.userId);

    if (!userWithRoles) return false;

    return userWithRoles.userRole.some((userRole) => {
      return userRole.role.rolePolicy.some((rolePolicy) => {
        const policy = rolePolicy.policy;
        return (
          policy.definition['resource'] === resource &&
          policy.definition['actions'].includes(action)
        );
      });
    });
  }
}
