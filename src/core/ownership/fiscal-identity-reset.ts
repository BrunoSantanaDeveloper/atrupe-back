import { Prisma } from '@prisma/client';

export function formatCnpj(digits: string | null | undefined): string {
  const d = String(digits ?? '').replace(/\D/g, '');
  if (d.length !== 14) return d;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/**
 * O que é fiscal deixa de valer quando uma transferência de titularidade troca
 * o CNPJ (decisão do PO): o módulo de Nota Fiscal volta ao começo e exige nova
 * configuração, e o que foi emitido antes fica como histórico.
 *
 * - Os emissores do CNPJ anterior são desativados e deixam de ser o padrão —
 *   mas não apagados: as notas os referenciam, e a nota emitida sob a
 *   titularidade anterior continua dizendo em nome de quem foi emitida. O nome
 *   ganha o CNPJ anterior, para a origem ficar à vista.
 * - Os ambientes deles ficam DISABLED.
 * - A chave de acesso ao provedor e o certificado digital, que são do CNPJ
 *   anterior, são apagados: não servem ao novo, e não devem ficar à mão.
 *
 * Os dados fiscais da empresa (IE, IM, CNAE, chaves) e a data que separa o
 * histórico (Company.fiscalResetAt) são gravados por quem chama, junto da nova
 * identidade. O onboarding volta a "não iniciado" porque passa a considerar só
 * o que veio depois dessa data.
 */
export async function resetFiscalIdentity(
  tx: Prisma.TransactionClient,
  input: { companyId: string; previousCnpj: string | null; now: Date },
): Promise<{ emitters: number; onboardingClosed: number }> {
  const emitters = await tx.invoicyConfig.findMany({
    where: { companyId: input.companyId },
    select: { id: true, name: true },
  });

  const suffix = input.previousCnpj
    ? ` (CNPJ anterior ${formatCnpj(input.previousCnpj)})`
    : ' (CNPJ anterior)';
  for (const emitter of emitters) {
    await tx.invoicyConfig.update({
      where: { id: emitter.id },
      data: {
        isActive: false,
        isDefault: false,
        // O de uma troca anterior já diz de qual CNPJ é.
        name: emitter.name.includes('(CNPJ anterior')
          ? emitter.name
          : `${emitter.name}${suffix}`,
      },
    });
  }

  if (emitters.length > 0) {
    await tx.invoicyEnvironmentConfig.updateMany({
      where: { invoicyConfigId: { in: emitters.map((e) => e.id) } },
      data: { status: 'DISABLED' },
    });
  }
  await tx.companyEnvironmentCredential.deleteMany({
    where: { companyId: input.companyId },
  });
  await tx.digitalCertificate.deleteMany({
    where: { companyId: input.companyId },
  });

  // Um pedido de ativação do CNPJ anterior que ainda estivesse em curso, se
  // aprovado depois, gravaria esse CNPJ de volta na empresa.
  const { count: onboardingClosed } =
    await tx.fiscalOnboardingRequest.updateMany({
      where: {
        companyId: input.companyId,
        status: { in: ['PENDING', 'PROVISIONING', 'PENDING_REVIEW'] },
      },
      data: {
        status: 'REJECTED',
        errorMessage:
          'Encerrado pela transferência de titularidade: o CNPJ da empresa mudou.',
        resolvedAt: input.now,
      },
    });

  return { emitters: emitters.length, onboardingClosed };
}
