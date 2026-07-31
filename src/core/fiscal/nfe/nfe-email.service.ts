import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { NfeStatus, NfeCorrectionStatus } from '@prisma/client';
import { PrismaService } from 'nestjs-prisma';
import { MailService } from '../../mail/mail.service';

interface SendAuthorizedNfeEmailParams {
  nfe: any;
  config: any;
  recipientEmail?: string | null;
  recipientName?: string | null;
  automatic?: boolean;
}

@Injectable()
export class NfeEmailService {
  private readonly logger = new Logger(NfeEmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  async sendAuthorizedNfeEmail({
    nfe,
    config,
    recipientEmail,
    recipientName,
    automatic = false,
  }: SendAuthorizedNfeEmailParams) {
    // CORRECTION_SENT tambem e' uma nota valida: bloquear o envio depois da
    // primeira CC-e impedia ate' o reenvio da propria NF-e ao destinatario.
    if (
      !nfe ||
      (nfe.status !== NfeStatus.AUTHORIZED &&
        nfe.status !== NfeStatus.CORRECTION_SENT)
    ) {
      throw new BadRequestException(
        'Apenas NF-e autorizadas podem ser enviadas por e-mail',
      );
    }

    if (automatic && !config?.sendDanfeXmlAutomatically) {
      return { success: false, skipped: true, reason: 'automatic-disabled' };
    }

    const sendDanfe = config?.sendDanfeAutomatically !== false;
    const sendXml = config?.sendXmlAutomatically !== false;

    if (!sendDanfe && !sendXml) {
      return { success: false, skipped: true, reason: 'nothing-to-send' };
    }

    const to = this.cleanEmail(recipientEmail || this.getDraftEmail(nfe));
    const copyTo = this.cleanEmail(config?.sendFiscalEmailCopyTo);
    const recipients = [to, copyTo].filter(Boolean);

    if (!to) {
      await this.markEmailError(nfe.id, 'Destinatario sem e-mail cadastrado');
      if (automatic) {
        this.logger.warn(
          `NF-e ${nfe.id} autorizada sem e-mail de destinatario para envio automatico`,
        );
        return { success: false, skipped: true, reason: 'missing-recipient' };
      }
      throw new BadRequestException('Destinatario sem e-mail cadastrado');
    }

    const attachments = [];
    const identifier = nfe.chaveAcesso || `${nfe.numero}_${nfe.serie}`;
    if (sendXml && nfe.xmlAutorizado) {
      attachments.push({
        filename: `NFe_${identifier}.xml`,
        content: nfe.xmlAutorizado,
        contentType: 'application/xml',
      });
    }

    // O emitente e' obrigado a dar ciencia das correcoes ao destinatario, entao
    // as CC-e registradas seguem junto com o XML da nota.
    const correctionEvents = sendXml
      ? await this.prisma.nfeCorrectionEvent.findMany({
          where: {
            nfeId: nfe.id,
            status: NfeCorrectionStatus.REGISTERED,
            xmlEvento: { not: null },
          },
          select: { sequenciaEvento: true, xmlEvento: true },
          orderBy: { sequenciaEvento: 'asc' },
        })
      : [];

    for (const event of correctionEvents) {
      attachments.push({
        filename: `CCe_${identifier}_seq_${event.sequenciaEvento}.xml`,
        content: event.xmlEvento,
        contentType: 'application/xml',
      });
    }

    try {
      await this.mailService.sendEmail(
        recipients.join(','),
        `NF-e ${nfe.numero}/${nfe.serie} autorizada`,
        'nfe-authorized',
        {
          recipientName: recipientName || this.getDraftName(nfe) || 'Cliente',
          emitterName:
            config?.company?.legalName || config?.company?.name || 'Atrupe',
          numero: nfe.numero,
          serie: nfe.serie,
          chaveAcesso: nfe.chaveAcesso || '',
          valorTotal: this.formatCurrency(nfe.valorTotal),
          danfeUrl: sendDanfe ? nfe.danfeUrl || '' : '',
          hasDanfe: !!(sendDanfe && nfe.danfeUrl),
          hasXml: !!(sendXml && nfe.xmlAutorizado),
        },
        attachments,
      );

      await this.prisma.nfe.update({
        where: { id: nfe.id },
        data: {
          emailSentAt: new Date(),
          emailSentTo: recipients.join(','),
          emailSendError: null,
        },
      });

      return { success: true, sentTo: recipients };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Erro desconhecido no envio';
      await this.markEmailError(nfe.id, message);
      this.logger.error(`Erro ao enviar e-mail da NF-e ${nfe.id}: ${message}`);

      if (automatic) {
        return { success: false, error: message };
      }

      throw new BadRequestException(
        `Erro ao enviar e-mail da NF-e: ${message}`,
      );
    }
  }

  private async markEmailError(nfeId: string, message: string) {
    await this.prisma.nfe.update({
      where: { id: nfeId },
      data: {
        emailSendError: message,
      },
    });
  }

  private cleanEmail(email?: string | null) {
    const value = email?.trim();
    return value && value.includes('@') ? value : null;
  }

  private getDraftEmail(nfe: any) {
    const draftData = this.getDraftData(nfe);
    return (
      draftData?.destinatario?.email ||
      draftData?.destEmail ||
      nfe?.order?.quotation?.client?.email ||
      nfe?.quotation?.client?.email ||
      null
    );
  }

  private getDraftName(nfe: any) {
    const draftData = this.getDraftData(nfe);
    return (
      draftData?.destinatario?.razaoSocial ||
      draftData?.destNome ||
      nfe?.order?.quotation?.client?.corporateName ||
      nfe?.order?.quotation?.client?.name ||
      nfe?.quotation?.client?.corporateName ||
      nfe?.quotation?.client?.name ||
      null
    );
  }

  private getDraftData(nfe: any) {
    if (!nfe?.draftData) return null;
    if (typeof nfe.draftData === 'string') {
      try {
        return JSON.parse(nfe.draftData);
      } catch {
        return null;
      }
    }
    return nfe.draftData;
  }

  private formatCurrency(value?: number | null) {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value || 0);
  }
}
