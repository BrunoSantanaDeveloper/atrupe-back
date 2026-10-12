import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { UserResponseDto } from './dto/response.dto';
import { CacheService } from 'src/svc/cache/cache.service';
import { PlugService } from 'src/svc/plug/plug.service';
import { UpdateUserDto } from './dto/update-user.dto';
import * as argon2 from 'argon2';
import { companyWithoutKeys } from 'src/shared/company/company-keys';

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
            company: companyWithoutKeys(user.employee[0].company),
            role: user.employee[0]?.role?.name,
            isAdmin: user.employee[0]?.role?.isAdmin,
          }
        : null,
      policies: user.employee[0]?.role?.permissions,
    };

    await this.cache.set(`user:${id}`, response);

    return response;
  }

  /** GET /user/:id: só o próprio usuário, o superadmin e a mesma empresa */
  async findOneForActor(id: string, actor: any) {
    await this.assertCanAccessUser(id, actor);
    return this.findOne(id);
  }

  check(doc: string) {
    return this.plug.people(doc);
  }

  findByEmail(email: string) {
    return this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, isActive: true },
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

  /**
   * O próprio usuário, o superadmin ou alguém da mesma empresa do alvo.
   */
  private async assertCanAccessUser(id: string, actor?: any) {
    if (!actor || actor.isSystemAdmin) return;

    if (actor.userId === id) return;

    if (!actor.companyId) {
      throw new ForbiddenException('Acesso negado.');
    }

    const targetUser = await this.prisma.user.findUnique({
      where: { id },
      select: {
        employee: {
          select: { companyId: true },
        },
      },
    });

    if (!targetUser) {
      throw new NotFoundException('Usuario nao encontrado.');
    }

    const sameCompany = targetUser.employee.some(
      (employee) => employee.companyId === actor.companyId,
    );

    if (!sameCompany) {
      throw new ForbiddenException('Acesso negado.');
    }
  }

  /**
   * O usuário do titular da conta: não é inativado (a titularidade sai só
   * por transferência), e o e-mail de acesso dele só ele muda.
   */
  private async assertOwnerRules(
    id: string,
    updateUserDto: UpdateUserDto,
    actor?: any,
  ) {
    const owns = await this.prisma.company.findFirst({
      where: { ownerUserId: id },
      select: { id: true },
    });
    if (!owns) return;

    if (updateUserDto.isActive === false) {
      throw new UnprocessableEntityException({
        code: 'OWNER_CANNOT_BE_DEACTIVATED',
        message:
          'Este usuário é o titular da conta e não pode ser inativado. Para isso, transfira a titularidade antes.',
      });
    }

    if (
      updateUserDto.email !== undefined &&
      actor &&
      !actor.isSystemAdmin &&
      actor.userId !== id
    ) {
      const current = await this.prisma.user.findUnique({
        where: { id },
        select: { email: true },
      });
      const next = String(updateUserDto.email).trim().toLowerCase();
      if (current && current.email.trim().toLowerCase() !== next) {
        throw new ForbiddenException({
          code: 'OWNER_ONLY',
          message: 'Só o titular da conta altera o próprio e-mail de acesso.',
        });
      }
    }
  }

  async update(id: string, updateUserDto: UpdateUserDto, actor?: any) {
    await this.assertCanAccessUser(id, actor);
    await this.assertOwnerRules(id, updateUserDto, actor);

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
          // Reativa o vínculo da empresa de quem reativa: com o usuário em
          // duas empresas, o primeiro vínculo podia ser o da outra
          const scope =
            actor?.companyId && !actor.isSystemAdmin
              ? { companyId: actor.companyId }
              : {};
          const employee = await tx.employee.findFirst({
            where: { userId: id, ...scope },
            select: { id: true },
          });

          if (employee) {
            await tx.employee.update({
              where: { id: employee.id },
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
