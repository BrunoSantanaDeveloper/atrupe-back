import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Logger,
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
import { CacheService } from 'src/svc/cache/cache.service';
import { PlugService } from 'src/svc/plug/plug.service';
import { randomInt, randomUUID } from 'crypto';
import { MailerService } from '@nestjs-modules/mailer';
import { CompanyService } from '../company/company.service';
import { CreateCompanyDto } from '../company/dto/create-company.dto';
import { EmployeeHistoryService } from '../employee/history/history.service';

@Injectable()
export class UserRegistrationService {
  private readonly logger = new Logger(UserRegistrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly plug: PlugService,
    private readonly companyService: CompanyService,
    private readonly mailerService: MailerService,
    private readonly employeeHistoryService: EmployeeHistoryService,
  ) {}

  async sendEmailValidation(
    email: string,
    name?: string,
    companyName?: string,
    phone?: string,
  ) {
    // Normalizar email para evitar problemas de case e espaços
    email = email.toLowerCase().trim();
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
      const response: Record<string, any> = {
        message: 'Email já possui um token de validação.',
        canResendIn: timeUntilExpiry,
      };
      if (
        process.env.APP_ENV !== 'production' ||
        email.endsWith('@atrupe-test.com')
      ) {
        response.devToken = existToken.token;
      }
      return response;
    }
    let token: string;
    let isUnique: any;
    do {
      // randomInt(min, max) é exclusivo no limite superior, então 10000 para incluir 9999
      token = randomInt(1000, 10000).toString();
      // Verificar unicidade apenas entre tokens ativos (não expirados) para evitar loop infinito
      isUnique = await this.prisma.mailVerification.findFirst({
        where: {
          token,
          expiresAt: { gte: new Date() },
        },
      });
    } while (isUnique);

    const resetPasswordExpires = new Date();
    resetPasswordExpires.setMinutes(resetPasswordExpires.getMinutes() + 10);

    await this.prisma.mailVerification.upsert({
      where: { email },
      create: {
        email,
        token,
        expiresAt: resetPasswordExpires,
        verified: false,
        name,
        companyName,
        phone,
      },
      update: {
        token,
        expiresAt: resetPasswordExpires,
        verified: false,
        name,
        companyName,
        phone,
      },
    });

    await this.mailerService
      .sendMail({
        to: email,
        subject: 'Validação de E-mail',
        template: 'email-validation',
        context: { token },
      })
      .catch((err) => {
        this.logger.error('Falha ao enviar email de validação:', err);
      });

    const response: Record<string, any> = {
      message: 'Email de validação enviado com sucesso.',
    };

    if (
      process.env.APP_ENV !== 'production' ||
      email.endsWith('@atrupe-test.com')
    ) {
      response.devToken = token;
    }

    return response;
  }

  async verifyEmail(body: { email: string; token: string }) {
    // Normalizar email para evitar falhas por diferença de case ou espaços
    const normalizedEmail = body.email.toLowerCase().trim();
    const user = await this.prisma.mailVerification.findFirst({
      where: {
        email: normalizedEmail,
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
    // Normalizar email
    createUserDto.email = createUserDto.email.toLowerCase().trim();
    const isVerified = await this.prisma.mailVerification.findFirst({
      where: { email: createUserDto.email, verified: true },
    });
    if (!isVerified) {
      throw new BadRequestException('Email não verificado.');
    }

    let createdCompanyId: string | null = null;
    let createdUserId: string | null = null;
    let createdCustomerId: string | null = null;

    // Identificador único da conversão de cadastro (§5.2). Gerado no backend,
    // gravado contra o usuário e retornado ao frontend para uso no OpenAI Pixel
    // e reutilização futura pela Conversions API (dedup navegador/servidor).
    const signupEventId = randomUUID();

    try {
      const hashedPassword = await argon2.hash(createUserDto.password);

      const { user, customer } = await this.prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: {
            name: createUserDto.name,
            email: createUserDto.email,
            password: hashedPassword,
            phone: createUserDto.mobile,
            signupEventId,
            signupOppref: createUserDto.oppref ?? null,
            signupUtm: createUserDto.utm ?? Prisma.JsonNull,
            signupGclid: createUserDto.gclid ?? null,
          },
        });

        const trialPlan = await tx.plan.findFirst({
          where: { planType: 'TRIAL' },
          include: {
            planLimits: {
              include: { limit: true },
            },
          },
        });

        let newCustomer = null;

        if (trialPlan) {
          const trialDaysLimit = trialPlan.planLimits.find(
            (pl) => pl.limit.key === 'trial_days',
          );
          const trialDays = trialDaysLimit?.value || 7;

          newCustomer = await tx.customer.create({
            data: {
              name: createUserDto.name,
              email: createUserDto.email,
              document: `temp_${newUser.id}`,
              asaasCustomerId: `trial_${newUser.id}`,
              companyId: null,
            },
          });

          await tx.user.update({
            where: { id: newUser.id },
            data: { customerId: newCustomer.id },
          });

          const trialEndDate = new Date();
          trialEndDate.setDate(trialEndDate.getDate() + trialDays);

          await tx.subscription.create({
            data: {
              customerId: newCustomer.id,
              planId: trialPlan.id,
              companyId: null,
              asaasSubscriptionId: `trial_sub_${newUser.id}`,
              nextDueDate: trialEndDate,
              value: 0,
            },
          });

          this.logger.log(
            `Plano TRIAL criado para usuário ${newUser.email} - válido até ${trialEndDate.toISOString()} (${trialDays} dias)`,
          );
        } else {
          this.logger.warn(
            'Plano TRIAL não encontrado - subscription não criada',
          );
        }

        return { user: newUser, customer: newCustomer };
      });
      createdUserId = user.id;
      createdCustomerId = customer?.id ?? null;

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

      if (customer) {
        await this.prisma.customer.update({
          where: { id: customer.id },
          data: { companyId: company.id },
        });
        await this.prisma.subscription.updateMany({
          where: { customerId: customer.id, companyId: null },
          data: { companyId: company.id },
        });
      }

      // O CPF não é pedido no cadastro: vem na contratação, do representante
      // legal ou do próprio contratante pessoa física.
      await this.companyService.createFirstAccess(
        createUserDto.email,
        company.id,
      );
      this.logger.log('First access configured successfully');

      await this.prisma.mailVerification.deleteMany({
        where: { email: createUserDto.email },
      });

      return {
        message: 'Usuário criado com sucesso com plano TRIAL.',
        eventId: signupEventId,
      };
    } catch (error) {
      this.logger.error('Erro ao criar usuário:', error);

      // Desfaz tudo o que o cadastro criou, não só a empresa: um usuário que
      // sobra sem empresa trava o e-mail — a próxima tentativa cai em "E-mail
      // já cadastrado" e a pessoa só consegue seguir com outro endereço.
      if (createdCompanyId) {
        await this.prisma.company
          .delete({ where: { id: createdCompanyId } })
          .catch(() => {});
      }
      if (createdUserId) {
        await this.discardSignup(createdUserId, createdCustomerId);
      }

      if (error instanceof PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException('E-mail já cadastrado.');
        }
      }
      throw error;
    }
  }

  /**
   * Apaga o usuário, a assinatura de teste e o cliente de um cadastro que não
   * chegou ao fim. Nessa ordem: o usuário aponta para o cliente, e a
   * assinatura também.
   */
  private async discardSignup(userId: string, customerId: string | null) {
    try {
      await this.prisma.user.delete({ where: { id: userId } });
      if (customerId) {
        await this.prisma.subscription.deleteMany({ where: { customerId } });
        await this.prisma.customer.delete({ where: { id: customerId } });
      }
    } catch (error) {
      this.logger.error(
        `RECONCILIAR: cadastro incompleto do usuário ${userId} não foi desfeito; o e-mail fica preso até a limpeza manual: ${error?.message}`,
      );
    }
  }

  async create(createUserDto: CreateMailVerificationDto): Promise<any> {
    // Normalizar email para garantir consistência
    createUserDto.email = createUserDto.email.toLowerCase().trim();
    try {
      const user = await this.prisma.user.findFirst({
        where: { email: createUserDto.email },
      });
      if (user) {
        throw new ConflictException('E-mail já cadastrado.');
      }

      const customer = await this.prisma.customer.findFirst({
        where: { email: createUserDto.email },
      });
      if (customer) {
        throw new ConflictException('E-mail já cadastrado.');
      }

      return await this.sendEmailValidation(
        createUserDto.email,
        createUserDto.name,
        createUserDto.companyName,
        createUserDto.phone,
      );
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
    createdByUserId?: string,
    createdByUserName?: string,
  ): Promise<any> {
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
          select: { id: true },
        });

        if (!employee) {
          throw new NotFoundException('Employee not found');
        }

        data.employee = {
          connect: { id: employee.id },
        };
      }

      const user = await this.prisma.user.create({
        data: data,
      });

      if (createUserDto.employeeId && createdByUserId) {
        await this.employeeHistoryService.createEmployeeHistory({
          employeeId: createUserDto.employeeId,
          action: 'CREATE_USER',
          description: `Usuário criado: ${user.email} (${user.name})`,
          metadata: {
            userId: user.id,
            userEmail: user.email,
            userName: user.name,
          },
          createdBy: createdByUserId,
          createdByName: createdByUserName,
        });
      }

      return user;
    } catch (error) {
      console.error(error);
      if (error instanceof PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException(
            'O endereço de e-mail informado já está atribuído a outro usuário',
          );
        }
      }
      throw error;
    }
  }
}
