import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from 'nestjs-prisma';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { CreateUserDto } from './dto/create.dto';
import * as argon2 from 'argon2';
import { UserResponseDto } from './dto/response.dto';
import { CacheService } from 'src/svc/cache/cache.service';
import { PlugService } from 'src/svc/plug/plug.service';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly plug: PlugService,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<User> {
    try {
      const hashedPassword = await argon2.hash(createUserDto.password);
      const data: Prisma.UserCreateInput = {
        name: createUserDto.name,
        email: createUserDto.email,
        password: hashedPassword,
      };

      if (createUserDto.employeeId) {
        const employee = await this.prisma.employee.findFirst({
          where: { id: createUserDto.employeeId },
        });

        if (!employee) {
          throw new NotFoundException('Employee not found');
        }

        data.employee = {
          connect: { id: employee.id },
        };
      }

      return await this.prisma.user.create({
        data: data,
      });
    } catch (error) {
      console.error(error);
      if (error instanceof PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException('Email already exists');
        }
      }
      throw error;
    }
  }

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
            company: true,
            role: true,
          },
          take: 1,
        },
        userRole: {
          select: {
            role: {
              select: {
                permissions: true,
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
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      employee: user.employee?.[0]
        ? {
            company: user.employee[0].company,
            role: user.employee[0]?.role?.name,
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
        employee: {
          select: {
            id: true,
            role: true,
            avatarUrl: true,
            company: true,
          },
        },
      },
    });
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    const { isActive, ...rest } = updateUserDto;

    return this.prisma.$transaction(async (tx) => {
      try {
        // Atualiza os dados do usuário
        const userUpdate = await tx.user.update({
          where: { id },
          data: {
            ...rest,
            isActive,
          },
        });

        // Caso o usuário seja ativado, ativa o colaborador vinculado (se existir)
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
  }
}
