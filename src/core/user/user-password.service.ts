import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
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

  async forgotPassword(forgotPasswordDto: ForgotPasswordDto): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { email: forgotPasswordDto.email },
    });
    if (!user) {
      // Não revelamos se o email existe ou não por questões de segurança
      return;
    }

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
        subject: 'Redefinição de Senha',
        template: 'reset-password',
        context: {
          name: user.name,
          resetLink: `${process.env.FRONTEND_URL}/redefinir-senha?token=${resetToken}`,
        },
      })
      .catch((err) => {
        this.logger.error(
          'Falha ao enviar email de redefinição de senha:',
          err,
        );
      });
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
      throw new UnauthorizedException('Token inválido ou expirado');
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
