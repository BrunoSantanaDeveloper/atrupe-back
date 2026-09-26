import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { CompleteRegistrationDto } from './dto/complete-registration.dto';
import { EditClientDto } from './dto/edit-client.dto';
import * as argon2 from 'argon2';
import { Prisma } from '@prisma/client';
import { MailerService } from '@nestjs-modules/mailer';
import { CompanyService } from '../company/company.service';
import { CreateCompanyDto } from '../company/dto/create-company.dto';

@Injectable()
export class UserOnboardingService {
  private readonly logger = new Logger(UserOnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly companyService: CompanyService,
    private readonly mailerService: MailerService,
  ) {}

  async completeRegistration(
    completeRegistrationDto: CompleteRegistrationDto,
    adminUserId: string,
  ) {
    const mailVerification = await this.prisma.mailVerification.findUnique({
      where: {
        id: completeRegistrationDto.id,
      },
    });

    if (!mailVerification) {
      throw new NotFoundException('Cadastro incompleto não encontrado.');
    }

    const adminUser = await this.prisma.user.findFirst({
      where: { id: adminUserId },
    });

    if (!adminUser) {
      throw new UnauthorizedException('Usuário administrador não encontrado.');
    }

    const isPasswordValid = await argon2.verify(
      adminUser.password,
      completeRegistrationDto.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Senha do administrador incorreta.');
    }

    const normalizedEmail = completeRegistrationDto.email.toLowerCase().trim();

    const existingUser = await this.prisma.user.findFirst({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
    });
    if (existingUser) {
      throw new ConflictException('E-mail já cadastrado.');
    }

    const existingCustomer = await this.prisma.customer.findFirst({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
    });
    if (existingCustomer) {
      throw new ConflictException('E-mail já cadastrado.');
    }

    if (completeRegistrationDto.document) {
      const existingCompany = await this.prisma.company.findFirst({
        where: { cnpj: completeRegistrationDto.document },
      });
      if (existingCompany) {
        throw new ConflictException('CNPJ/CPF já cadastrado.');
      }
    }

    let createdUserId: string | null = null;
    let createdCompanyId: string | null = null;
    let createdCustomerId: string | null = null;

    try {
      const temporaryPassword = Math.random().toString(36).slice(-8);
      const hashedPassword = await argon2.hash(temporaryPassword);

      const userData: Prisma.UserCreateInput = {
        name: completeRegistrationDto.userName,
        email: normalizedEmail,
        password: hashedPassword,
        phone: completeRegistrationDto.phone,
      };
      const user = await this.prisma.user.create({
        data: userData,
      });
      createdUserId = user.id;

      const createCompany: CreateCompanyDto = {
        general: {
          phone: completeRegistrationDto.phone,
          name: completeRegistrationDto.companyName,
          legalName: completeRegistrationDto.legalName,
          cnpj: completeRegistrationDto.document,
          email: completeRegistrationDto.email,
          siteUrl: '',
          municipalRegistration: '',
          mobile: completeRegistrationDto.phone,
        },
        address: {
          street: '',
          number: '',
          neighborhood: '',
          city: completeRegistrationDto.cityId || '',
          state: completeRegistrationDto.stateId || '',
          zipcode: '',
        },
      };

      const company = await this.companyService.createMainCompany(
        completeRegistrationDto.email,
        createCompany,
      );
      createdCompanyId = company.id;
      this.logger.log('Company created successfully');

      // O usuário foi gravado com o e-mail normalizado, e o primeiro acesso o
      // procura pelo e-mail exato.
      await this.companyService.createFirstAccess(normalizedEmail, company.id);
      this.logger.log('First access configured successfully');

      await this.prisma.$transaction(async (tx) => {
        this.logger.log('Attempting to create trial plan...');

        const trialPlan = await tx.plan.findFirst({
          where: { planType: 'TRIAL' },
          include: {
            planLimits: {
              include: {
                limit: true,
              },
            },
          },
        });

        if (trialPlan) {
          const trialDaysLimit = trialPlan.planLimits.find(
            (pl) => pl.limit.key === 'trial_days',
          );
          const trialDays = trialDaysLimit?.value || 7;

          const customer = await tx.customer.create({
            data: {
              name: completeRegistrationDto.userName,
              email: completeRegistrationDto.email,
              document: completeRegistrationDto.document,
              asaasCustomerId: `trial_${user.id}`,
              companyId: company.id,
            },
          });
          createdCustomerId = customer.id;

          await tx.user.update({
            where: { id: user.id },
            data: { customerId: customer.id },
          });

          const trialEndDate = new Date();
          trialEndDate.setDate(trialEndDate.getDate() + trialDays);

          await tx.subscription.create({
            data: {
              customerId: customer.id,
              planId: trialPlan.id,
              companyId: company.id,
              asaasSubscriptionId: `trial_sub_${user.id}`,
              nextDueDate: trialEndDate,
              value: 0,
            },
          });

          this.logger.log(
            `Plano TRIAL criado para usuário ${user.email} - válido até ${trialEndDate.toISOString()} (${trialDays} dias)`,
          );
        } else {
          this.logger.warn(
            'Plano TRIAL não encontrado - subscription não criada',
          );
        }
      });

      await this.mailerService
        .sendMail({
          to: completeRegistrationDto.email,
          subject: 'Cadastro Efetuado - Atrupe',
          template: 'registration-complete',
          context: {
            name: completeRegistrationDto.userName,
            email: completeRegistrationDto.email,
            temporaryPassword,
            loginUrl: `${process.env.FRONTEND_URL}/login`,
          },
        })
        .catch((err) => {
          this.logger.error('Erro ao enviar email:', err);
        });

      await this.prisma.mailVerification.delete({
        where: { id: completeRegistrationDto.id },
      });

      return {
        message: 'Cadastro efetuado com sucesso. Email enviado ao cliente.',
      };
    } catch (error) {
      this.logger.error('Erro ao completar cadastro:', error);

      try {
        if (createdCustomerId) {
          await this.prisma.customer
            .delete({ where: { id: createdCustomerId } })
            .catch(() => {});
        }

        if (createdCompanyId) {
          await this.prisma.company
            .delete({ where: { id: createdCompanyId } })
            .catch(() => {});
        }

        if (createdUserId) {
          await this.prisma.user
            .delete({ where: { id: createdUserId } })
            .catch(() => {});
        }
      } catch (rollbackError) {
        this.logger.error('Erro durante rollback:', rollbackError);
      }

      if (error instanceof PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException('E-mail ou CNPJ já cadastrado.');
        }
      }
      throw error;
    }
  }

  async editClient(editClientDto: EditClientDto, adminUserId: string) {
    const adminUser = await this.prisma.user.findFirst({
      where: { id: adminUserId },
    });

    if (!adminUser) {
      throw new UnauthorizedException('Usuário administrador não encontrado.');
    }

    const isPasswordValid = await argon2.verify(
      adminUser.password,
      editClientDto.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Senha do administrador incorreta.');
    }

    const company = await this.prisma.company.findUnique({
      where: { id: editClientDto.id },
      include: {
        customer: {
          include: {
            user: true,
          },
        },
        address: true,
      },
    });

    if (!company) {
      throw new NotFoundException('Empresa não encontrada.');
    }

    if (company.customer.length > 0) {
      const currentEmail = company.customer[0].email;
      if (currentEmail !== editClientDto.email) {
        const userToExclude =
          company.customer[0].user && company.customer[0].user.length > 0
            ? company.customer[0].user[0].id
            : undefined;

        if (userToExclude) {
          const existingUser = await this.prisma.user.findFirst({
            where: {
              email: editClientDto.email,
              id: { not: userToExclude },
            },
          });
          if (existingUser) {
            throw new ConflictException('E-mail já cadastrado.');
          }
        }

        const existingCustomer = await this.prisma.customer.findFirst({
          where: {
            email: editClientDto.email,
            id: { not: company.customer[0].id },
          },
        });
        if (existingCustomer) {
          throw new ConflictException('E-mail já cadastrado.');
        }
      }
    }

    if (company.cnpj !== editClientDto.document) {
      const existingCompany = await this.prisma.company.findFirst({
        where: {
          cnpj: editClientDto.document,
          id: { not: editClientDto.id },
        },
      });
      if (existingCompany) {
        throw new ConflictException('CNPJ/CPF já cadastrado.');
      }
    }

    try {
      await this.prisma.company.update({
        where: { id: editClientDto.id },
        data: {
          name: editClientDto.companyName,
          legalName: editClientDto.legalName,
          cnpj: editClientDto.document,
          email: editClientDto.email,
          phone: editClientDto.phone,
          mobile: editClientDto.phone,
        },
      });

      if (company.address.length > 0) {
        await this.prisma.address.update({
          where: { id: company.address[0].id },
          data: {
            city: editClientDto.cityId || company.address[0].city,
            state: editClientDto.stateId || company.address[0].state,
          },
        });
      } else if (editClientDto.cityId || editClientDto.stateId) {
        await this.prisma.address.create({
          data: {
            companyId: editClientDto.id,
            city: editClientDto.cityId || '',
            state: editClientDto.stateId || '',
            street: '',
            number: '',
            neighborhood: '',
            zipcode: '',
          },
        });
      }

      if (company.customer.length > 0) {
        const customer = company.customer[0];
        await this.prisma.customer.update({
          where: { id: customer.id },
          data: {
            name: editClientDto.userName,
            email: editClientDto.email,
            document: editClientDto.document,
          },
        });

        if (customer.user && customer.user.length > 0) {
          await this.prisma.user.update({
            where: { id: customer.user[0].id },
            data: {
              name: editClientDto.userName,
              email: editClientDto.email,
              phone: editClientDto.phone,
            },
          });
        }
      }

      return {
        message: 'Cliente atualizado com sucesso.',
      };
    } catch (error) {
      this.logger.error('Erro ao editar cliente:', error);

      if (error instanceof PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException('E-mail ou CNPJ já cadastrado.');
        }
      }
      throw error;
    }
  }
}
