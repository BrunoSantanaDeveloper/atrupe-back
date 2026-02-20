import { Injectable } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { UserResponseDto } from './dto/response.dto';
import { CacheService } from 'src/svc/cache/cache.service';
import { PlugService } from 'src/svc/plug/plug.service';
import { UpdateUserDto } from './dto/update-user.dto';
import * as argon2 from 'argon2';

@Injectable()
export class UserCrudService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly plug: PlugService,
  ) {}

  findAll() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
      },
    });
  }

  async findOneRoles(id: string) {
    return this.prisma.user.findFirst({
      where: { id: id },
      include: {
        userRole: {
          include: {
            role: true,
          },
        },
      },
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: id },
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
        employee: {
          select: {
            name: true,
            company: true,
            role: true,
          },
          take: 1,
        },
        userRole: {
          select: {
            isSystemAdmin: true,
            role: {
              select: {
                permissions: true,
                isAdmin: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      return null;
    }

    const response: UserResponseDto = {
      id: user.id,
      name: user.employee[0]?.name ?? user.name,
      email: user.email,
      avatar: user.avatar,
      employee: user.employee?.[0]
        ? {
            company: user.employee[0].company,
            role: user.employee[0]?.role?.name,
            isAdmin: user.employee[0]?.role?.isAdmin,
          }
        : null,
      policies: user.employee[0]?.role?.permissions,
    };

    await this.cache.set(`user:${id}`, response);

    return response;
  }

  check(doc: string) {
    return this.plug.people(doc);
  }

  findByEmail(email: string) {
    return this.prisma.user.findFirst({
      where: { email: email, isActive: true },
      include: {
        customer: {
          include: {
            subscriptions: {
              where: {},
              include: {
                plan: { select: { planType: true } },
              },
            },
          },
        },
        employee: {
          select: {
            id: true,
            name: true,
            role: true,
            avatarUrl: true,
            company: true,
          },
        },
        userRole: {
          include: {
            role: true,
          },
        },
      },
    });
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    const { isActive, password, ...rest } = updateUserDto;

    const updatedUser = await this.prisma.$transaction(async (tx) => {
      try {
        let updatedData: any = { ...rest };

        if (password) {
          const hashedPassword = await argon2.hash(password);
          updatedData = { ...updatedData, password: hashedPassword };
        }

        const userUpdate = await tx.user.update({
          where: { id },
          data: {
            ...updatedData,
            isActive,
          },
        });

        if (isActive) {
          const user = await tx.user.findUnique({
            where: { id },
            select: { employee: { select: { id: true } } },
          });

          if (user?.employee) {
            await tx.employee.update({
              where: { id: user.employee[0].id },
              data: { isActive: true },
            });
          }
        }

        return userUpdate;
      } catch (error) {
        console.error(error);
        throw error;
      }
    });

    if (updatedUser.password) {
      delete updatedUser.password;
    }
    return updatedUser;
  }
}
