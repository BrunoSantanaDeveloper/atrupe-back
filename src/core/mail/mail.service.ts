import { Injectable } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MailService {
  constructor(
    private readonly mailerService: MailerService,
    private readonly configService: ConfigService,
  ) {}

  async sendEmail(
    to: string,
    subject: string,
    template: string,
    context: any,
    attachments: any[],
  ) {
    const appEnv = this.configService.get('APP_ENV');

    const toDev = 'danilo.santana@tribodev.com.br';

    // Em desenvolvimento, enviar para email de teste ao invés do destinatário real
    const recipient = appEnv === 'production' ? to : toDev;

    await this.mailerService.sendMail({
      to: recipient,
      subject,
      template,
      context,
      attachments,
    });
  }
}
