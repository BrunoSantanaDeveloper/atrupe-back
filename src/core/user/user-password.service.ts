import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { MailerService } from '@nestjs-modules/mailer';
import { randomBytes } from 'crypto';
import * as argon2 from 'argon2';

@Injectable()
export class UserPasswordService {
  private readonly logger = new Logger(UserPasswordService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailerService: MailerService,
  ) {}

  private generateTemporaryPassword(): string {
    return `${randomBytes(4).toString('hex')}A!${randomBytes(4).toString('hex')}1`;
  }

  private async validateAdminPassword(
    adminUserId: string,
    adminPassword: string,
  ) {
    const adminUser = await this.prisma.user.findUnique({
      where: { id: adminUserId },
      select: { id: true, name: true, password: true },
    });

    if (!adminUser) {
      throw new UnauthorizedException('Administrador nao encontrado.');
    }

    const isPasswordValid = await argon2.verify(
      adminUser.password,
      adminPassword,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Senha do administrador incorreta.');
    }

    return adminUser;
  }

  private async sendPasswordResetEmail(user: {
    id: string;
    email: string;
    name: string;
  }): Promise<void> {
    const resetToken = randomBytes(32).toString('hex');

    const resetPasswordExpires = new Date();
    resetPasswordExpires.setHours(resetPasswordExpires.getHours() + 1);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        resetPasswordToken: resetToken,
        resetPasswordExpires,
      },
    });

    await this.mailerService
      .sendMail({
        to: user.email,
        subject: 'Redefinicao de Senha',
        template: 'reset-password',
        context: {
          name: user.name,
          resetLink: `${process.env.FRONTEND_URL}/redefinir-senha?token=${resetToken}`,
        },
      })
      .catch((err) => {
        this.logger.error(
          'Falha ao enviar email de redefinicao de senha:',
          err,
        );
      });
  }

  async forgotPassword(forgotPasswordDto: ForgotPasswordDto): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { email: forgotPasswordDto.email },
    });
    if (!user) {
      // Nao revelamos se o email existe ou nao por questoes de seguranca.
      return;
    }

    await this.sendPasswordResetEmail(user);
  }

  async adminPasswordReset(
    targetUserId: string,
    adminUserId: string,
    adminPassword: string,
  ): Promise<void> {
    const adminUser = await this.validateAdminPassword(
      adminUserId,
      adminPassword,
    );

    const targetUser = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, name: true, email: true },
    });

    if (!targetUser) {
      throw new NotFoundException('Usuario nao encontrado.');
    }

    await this.sendPasswordResetEmail(targetUser);

    this.logger.log(
      `Reset de senha solicitado pelo admin ${adminUser.id} para o usuario ${targetUser.id}`,
    );
  }

  async adminGeneratePassword(
    targetUserId: string,
    adminUserId: string,
    adminPassword: string,
  ): Promise<{ temporaryPassword: string }> {
    const adminUser = await this.validateAdminPassword(
      adminUserId,
      adminPassword,
    );

    const targetUser = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true },
    });

    if (!targetUser) {
      throw new NotFoundException('Usuario nao encontrado.');
    }

    const temporaryPassword = this.generateTemporaryPassword();
    const hashedPassword = await argon2.hash(temporaryPassword);

    await this.prisma.user.update({
      where: { id: targetUser.id },
      data: {
        password: hashedPassword,
        resetPasswordToken: null,
        resetPasswordExpires: null,
      },
    });

    this.logger.log(
      `Senha temporaria gerada pelo admin ${adminUser.id} para o usuario ${targetUser.id}`,
    );

    return { temporaryPassword };
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: {
        resetPasswordToken: resetPasswordDto.token,
        resetPasswordExpires: {
          gt: new Date(),
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Token invalido ou expirado');
    }

    const hashedPassword = await argon2.hash(resetPasswordDto.password);

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
