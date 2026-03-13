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
import { randomInt } from 'crypto';
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
    let token: string;
    let isUnique: any;
    do {
      token = randomInt(1000, 9999).toString();
      isUnique = await this.prisma.mailVerification.findFirst({
        where: { token },
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

    let createdCompanyId: string | null = null;

    try {
      const hashedPassword = await argon2.hash(createUserDto.password);

      const { customer } = await this.prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: {
            name: createUserDto.name,
            email: createUserDto.email,
            password: hashedPassword,
            phone: createUserDto.mobile,
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

      await this.companyService.createFirstAccess(
        createUserDto.email,
        company.id,
      );
      this.logger.log('First access configured successfully');

      await this.prisma.mailVerification.deleteMany({
        where: { email: createUserDto.email },
      });

      return { message: 'Usuário criado com sucesso com plano TRIAL.' };
    } catch (error) {
      this.logger.error('Erro ao criar usuário:', error);

      if (createdCompanyId) {
        await this.prisma.company
          .delete({ where: { id: createdCompanyId } })
          .catch(() => {});
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
