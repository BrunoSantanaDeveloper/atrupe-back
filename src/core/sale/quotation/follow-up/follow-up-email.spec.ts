import { FollowUpService, escapeHtml } from './follow-up.service';

/**
 * O e-mail diário do acompanhamento (CRM-3): o valor do orçamento é em
 * centavos, e o texto do cadastro entra no HTML como texto.
 */
describe('FollowUpService — e-mail diário', () => {
  it('escapa o texto do cadastro', () => {
    expect(escapeHtml('<b>Zé & "Cia"</b>')).toBe(
      '&lt;b&gt;Zé &amp; &quot;Cia&quot;&lt;/b&gt;',
    );
    expect(escapeHtml(null)).toBe('');
  });

  it('manda ao vendedor o valor em reais, com o cadastro escapado', async () => {
    const prisma = {
      followUpSettings: {
        findMany: jest.fn().mockResolvedValue([{ companyId: 'empresa-a' }]),
      },
      quotation: {
        findMany: jest.fn().mockResolvedValue([
          {
            quotationNumber: 12,
            description: 'Banner',
            totalValue: 9500,
            dueDate: null,
            nextContactAt: new Date('2026-10-28T12:00:00Z'),
            nextContactNote: 'ligar <depois>',
            series: { code: 'A' },
            client: { name: '<script>x</script>' },
            seller: {
              id: 's1',
              name: 'Ana',
              user: { email: 'ana@exemplo.com', name: 'Ana' },
            },
          },
        ]),
      },
      company: { findUnique: jest.fn().mockResolvedValue({ name: 'Gráfica' }) },
    };
    const mailer = { sendMail: jest.fn() };
    const service = new FollowUpService(prisma as any, mailer as any);

    // 11h05 em São Paulo
    await service.sendDailyEmails(new Date('2026-10-28T14:05:00Z'));

    expect(prisma.followUpSettings.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { dailyEmail: true, dailyEmailHour: 11 },
      }),
    );
    const mail = mailer.sendMail.mock.calls[0][0];
    expect(mail.to).toBe('ana@exemplo.com');
    expect(mail.html).toMatch(/R\$\s95,00/);
    expect(mail.html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(mail.html).toContain('ligar &lt;depois&gt;');
    expect(mail.html).not.toContain('<script>');
  });
});
