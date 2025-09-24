import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'nestjs-prisma';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import {
  CreateMailVerificationDto,
  CreateUserByEmployeeDto,
  CreateUserDto,
} from './dto/create.dto';
import * as argon2 from 'argon2';
import { UserResponseDto } from './dto/response.dto';
import { CacheService } from 'src/svc/cache/cache.service';
import { PlugService } from 'src/svc/plug/plug.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { randomBytes } from 'crypto';
import { MailerService } from '@nestjs-modules/mailer';
import { CompanyService } from '../company/company.service';
import { CreateCompanyDto } from '../company/dto/create-company.dto';
import { Logger } from '@nestjs/common';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly plug: PlugService,
    private readonly companyService: CompanyService,
    private readonly mailerService: MailerService,
  ) {}

  async sendEmailValidation(email: string) {
    const existToken = await this.prisma.mailVerification.findFirst({
      where: {
        email,
        expiresAt: {
          gte: new Date(),
        },
      },
    });
    if (existToken) {
      const now = new Date();
      const timeUntilExpiry = Math.ceil(
        (existToken.expiresAt.getTime() - now.getTime()) / 1000,
      );
      return {
        message: 'Email já possui um token de validação.',
        canResendIn: timeUntilExpiry,
      };
    }
    let token;
    let isUnique;
    // Gera um código numérico de 4 dígitos
    do {
      token = Math.floor(1000 + Math.random() * 9000).toString();
      isUnique = await this.prisma.mailVerification.findFirst({
        where: { token },
      });
    } while (isUnique);

    // Define a expiração para 2 minutos a partir de agora
    const resetPasswordExpires = new Date();
    resetPasswordExpires.setMinutes(resetPasswordExpires.getMinutes() + 2);

    // Atualiza o usuário com o token e data de expiração
    await this.prisma.mailVerification.upsert({
      where: { email },
      create: {
        email,
        token,
        expiresAt: resetPasswordExpires,
        verified: false,
      },
      update: {
        token,
        expiresAt: resetPasswordExpires,
        verified: false,
      },
    });

    // Envia o e-mail com o código
    await this.mailerService
      .sendMail({
        to: email,
        subject: 'Validação de E-mail',
        template: 'email-validation',
        context: { token },
      })
      .catch((err) => {
        console.error(err);
      });

    return { message: 'Email de validação enviado com sucesso.' };
  }

  async verifyEmail(body: { email: string; token: string }) {
    const user = await this.prisma.mailVerification.findFirst({
      where: {
        email: body.email,
        token: body.token,
        expiresAt: {
          gte: new Date(),
        },
      },
    });

    if (!user) {
      throw new BadRequestException('Token inválido ou expirado.');
    }

    await this.prisma.mailVerification.update({
      where: { email: user.email },
      data: {
        verified: true,
        token: null,
        expiresAt: null,
      },
    });

    return { message: 'Email verificado com sucesso.' };
  }

  async createPassword(createUserDto: CreateUserDto) {
    const isVerified = await this.prisma.mailVerification.findFirst({
      where: { email: createUserDto.email, verified: true },
    });
    if (!isVerified) {
      throw new BadRequestException('Email não verificado.');
    }

    let createdUserId: string | null = null;
    let createdCompanyId: string | null = null;
    let createdCustomerId: string | null = null;

    try {
      // Primeira etapa: Criar usuário
      const hashedPassword = await argon2.hash(createUserDto.password);
      const userData: Prisma.UserCreateInput = {
        name: createUserDto.name,
        email: createUserDto.email,
        password: hashedPassword,
        phone: createUserDto.mobile,
      };
      const user = await this.prisma.user.create({
        data: userData,
      });
      createdUserId = user.id;

      // Segunda etapa: Criar empresa (fora da transação)
      const createCompany: CreateCompanyDto = {
        general: {
          phone: createUserDto.mobile,
          name: createUserDto.company,
          legalName: createUserDto.company,
          cnpj: '',
          email: createUserDto.email,
          siteUrl: '',
          municipalRegistration: '',
          mobile: createUserDto.mobile,
        },
        address: {
          street: '',
          number: '',
          neighborhood: '',
          city: '',
          state: '',
          zipcode: '',
        },
      };

      const company = await this.companyService.createMainCompany(
        createUserDto.email,
        createCompany,
      );
      createdCompanyId = company.id;
      this.logger.log('Company created successfully');

      // Configurar primeiro acesso: conectar user à company com role admin
      await this.companyService.createFirstAccess(
        createUserDto.email,
        company.id,
      );
      this.logger.log('First access configured successfully');

      // Terceira etapa: Configurar plano TRIAL em transação separada
      await this.prisma.$transaction(async (tx) => {
        this.logger.log('Attempting to create trial plan...');

        // Buscar plano TRIAL
        const trialPlan = await tx.plan.findFirst({
          where: { planType: 'TRIAL' },
        });

        if (trialPlan) {
          // Criar customer
          const customer = await tx.customer.create({
            data: {
              name: createUserDto.name,
              email: createUserDto.email,
              document: `temp_${user.id}`, // Document único temporário
              asaasCustomerId: `trial_${user.id}`,
              companyId: company.id,
            },
          });
          createdCustomerId = customer.id;

          // Conectar user ao customer
          await tx.user.update({
            where: { id: user.id },
            data: { customerId: customer.id },
          });

          // Criar subscription com plano TRIAL
          const trialEndDate = new Date();
          trialEndDate.setDate(trialEndDate.getDate() + 7); // 7 dias de trial

          await tx.subscription.create({
            data: {
              customerId: customer.id,
              planId: trialPlan.id,
              companyId: company.id,
              additionalUsers: 0,
              asaasSubscriptionId: `trial_sub_${user.id}`,
              // modules campo removido - usar subscriptionFeatures
              nextDueDate: trialEndDate,
              cycle: 'MONTHLY',
              billingType: 'CREDIT_CARD',
              value: trialPlan.basePrice,
            },
          });

          this.logger.log(
            `Plano TRIAL criado para usuário ${user.email} - válido até ${trialEndDate.toISOString()}`,
          );
        } else {
          this.logger.warn(
            'Plano TRIAL não encontrado - subscription não criada',
          );
        }
      });

      // Quarta etapa: Limpar verificação de email
      await this.prisma.mailVerification.deleteMany({
        where: { email: createUserDto.email },
      });

      return { message: 'Usuário criado com sucesso com plano TRIAL.' };
    } catch (error) {
      this.logger.error('Erro ao criar usuário:', error);

      // Rollback manual: remover dados criados em caso de erro
      try {
        if (createdCustomerId) {
          await this.prisma.customer
            .delete({
              where: { id: createdCustomerId },
            })
            .catch(() => {}); // Ignora erros de limpeza
        }

        if (createdCompanyId) {
          // Remove empresa e dados relacionados
          await this.prisma.company
            .delete({
              where: { id: createdCompanyId },
            })
            .catch(() => {}); // Ignora erros de limpeza
        }

        if (createdUserId) {
          await this.prisma.user
            .delete({
              where: { id: createdUserId },
            })
            .catch(() => {}); // Ignora erros de limpeza
        }
      } catch (rollbackError) {
        this.logger.error('Erro durante rollback:', rollbackError);
      }

      if (error instanceof PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException('E-mail já cadastrado.');
        }
      }
      throw error;
    }
  }
  async create(createUserDto: CreateMailVerificationDto): Promise<any> {
    try {
      // Verificar se já existe um User com este email
      const user = await this.prisma.user.findFirst({
        where: { email: createUserDto.email },
      });
      if (user) {
        throw new ConflictException('E-mail já cadastrado.');
      }

      // Verificar se já existe um Customer com este email
      const customer = await this.prisma.customer.findFirst({
        where: { email: createUserDto.email },
      });
      if (customer) {
        throw new ConflictException('E-mail já cadastrado.');
      }

      return await this.sendEmailValidation(createUserDto.email);
    } catch (error) {
      console.error(error);
      if (error instanceof PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException('E-mail já cadastrado.');
        }
      }
      throw error;
    }
  }

  async createUserForEmployee(
    createUserDto: CreateUserByEmployeeDto,
  ): Promise<any> {
    console.log(createUserDto);
    // const company = await this.prisma.company.findFirst({
    //   where: {
    //     id: createUserDto.company,
    //   },
    //   select: {
    //     id: true,
    //     customer: {
    //       select: {
    //         subscriptions: {
    //           orderBy: { createdAt: 'desc' },
    //           take: 1,
    //           select: {
    //             plan: {
    //               select: {
    //                 planType: true,
    //               },
    //             },
    //           },
    //         },
    //       },
    //     },
    //   },
    // });

    // if (!company) {
    //   throw new NotFoundException('Company not found');
    // }

    // const planType =
    //   company.customer[0]?.subscriptions[0]?.plan?.planType ?? 'TRIAL';

    // // Contar quantos employees já têm um usuário cadastrado
    // const employeesWithUser = await this.prisma.employee.findMany({
    //   where: {
    //     companyId: createUserDto.company,
    //     user: {
    //       // só conta os que têm relação com user
    //       isNot: null,
    //     },
    //   },
    //   select: { id: true },
    // });

    // const currentUserCount = employeesWithUser.length;

    // const planLimits: Record<string, number> = {
    //   TRIAL: 3,
    //   START: 3,
    //   LITE: 5,
    // };

    // const allowedUsers = planLimits[planType] ?? Infinity;

    // if (currentUserCount >= allowedUsers) {
    //   throw new ConflictException(
    //     `O plano ${planType} permite no máximo ${allowedUsers} usuários com acesso.`,
    //   );
    // }

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
            name: true,
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
      },
    });
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    const { isActive, password, ...rest } = updateUserDto;

    const updatedUser = await this.prisma.$transaction(async (tx) => {
      try {
        let updatedData: any = { ...rest };

        // Verifica se a senha foi enviada para ser atualizada
        if (password) {
          // Criptografa a nova senha
          const hashedPassword = await argon2.hash(password);
          updatedData = { ...updatedData, password: hashedPassword };
        }

        // Atualiza os dados do usuário
        const userUpdate = await tx.user.update({
          where: { id },
          data: {
            ...updatedData,
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

    if (updatedUser.password) {
      delete updatedUser.password;
    }
    return updatedUser;
  }

  async forgotPassword(forgotPasswordDto: ForgotPasswordDto): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { email: forgotPasswordDto.email },
    });
    if (!user) {
      // Não revelamos se o email existe ou não por questões de segurança
      return;
    }

    // Gera um token aleatório
    const resetToken = randomBytes(32).toString('hex');

    // Define a data de expiração para 1 hora a partir de agora
    const resetPasswordExpires = new Date();
    resetPasswordExpires.setHours(resetPasswordExpires.getHours() + 1);

    // Salva o token e a data de expiração no banco de dados
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        resetPasswordToken: resetToken,
        resetPasswordExpires,
      },
    });

    // Envia o email com o token
    await this.mailerService
      .sendMail({
        to: user.email,
        subject: 'Redefinição de Senha',
        template: 'reset-password',
        context: {
          name: user.name,
          resetLink: `${process.env.FRONTEND_URL}/redefinir-senha?token=${resetToken}`,
        },
      })
      .catch((err) => {
        console.error(err);
      });
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto): Promise<void> {
    // Encontra o usuário pelo token
    const user = await this.prisma.user.findFirst({
      where: {
        resetPasswordToken: resetPasswordDto.token,
        resetPasswordExpires: {
          gt: new Date(), // Verifica se o token não expirou
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Token inválido ou expirado');
    }

    // Criptografa a nova senha
    const hashedPassword = await argon2.hash(resetPasswordDto.password);

    // Atualiza a senha e limpa o token
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetPasswordToken: null,
        resetPasswordExpires: null,
      },
    });
  }
}
