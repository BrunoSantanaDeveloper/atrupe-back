import { ConflictException, Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from 'nestjs-prisma';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { CreateUserDto } from './dto/create.dto';
import * as argon2 from 'argon2';
import { UserResponseDto } from './dto/response.dto';
import { CacheService } from 'src/svc/cache/cache.service';
import { PlugService } from 'src/svc/plug/plug.service';

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
      return await this.prisma.user.create({
        data: {
          name: createUserDto.name,
          email: createUserDto.email,
          password: hashedPassword,
        },
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
            role: { include: { rolePolicy: { include: { policy: true } } } },
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
                rolePolicy: {
                  select: {
                    policy: true,
                  },
                },
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
      policies: user.userRole
        .flatMap((userRole) => userRole.role.rolePolicy)
        .map((rolePolicy) => rolePolicy.policy),
    };

    await this.cache.set(`user:${id}`, response);

    return response;
  }

  check(doc: string) {
    return this.plug.people(doc);
  }

  findByEmail(email: string) {
    return this.prisma.user.findFirst({
      where: { email: email },
      include: {
        employee: {
          select: {
            companyId: true,
          },
        },
      },
    });
  }

  update() {
    return 'This action updates a user';
  }
}
