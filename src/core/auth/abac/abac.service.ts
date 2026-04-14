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
    user: { userId: string; username: string },
    action: string,
    resource: string,
  ): Promise<boolean> {
    // Fetch user with employee role permissions (that's where permissions actually are)
    const userWithEmployee = await this.prisma.user.findFirst({
      where: { id: user.userId },
      select: {
        employee: {
          select: {
            role: {
              select: {
                permissions: true,
                isAdmin: true,
              },
            },
          },
          take: 1,
        },
        userRole: {
          select: {
            isSystemAdmin: true,
            role: {
              select: {
                permissions: true,
              },
            },
          },
        },
      },
    });

    if (!userWithEmployee) return false;

    // Check if user is system admin (has full access)
    const isSystemAdmin = userWithEmployee.userRole?.some(
      (ur) => ur.isSystemAdmin === true,
    );
    if (isSystemAdmin) return true;

    // Check if user's employee role is admin (has full access)
    const employeeRole = userWithEmployee.employee?.[0]?.role;
    if (employeeRole?.isAdmin) return true;

    // Get permissions from employee role
    const permissions = employeeRole?.permissions || [];

    if (permissions.length === 0) return false;

    return permissions.some((rolePolicy) => {
      // Wildcard: '*' grants all permissions
      if (rolePolicy === '*') return true;

      // Handle both 2-part (resource:action) and 3-part (category:resource:action) permissions
      const parts = rolePolicy.split(':');
      if (parts.length === 2) {
        const [userResource, userAction] = parts;
        return userResource === resource && userAction === action;
      } else if (parts.length === 3) {
        // For 3-part permissions like "sale:other_quotation:view"
        const userResource = `${parts[0]}:${parts[1]}`;
        const userAction = parts[2];
        return userResource === resource && userAction === action;
      }
      return false;
    });
  }
}
