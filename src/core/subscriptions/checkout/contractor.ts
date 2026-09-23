import { Logger, UnprocessableEntityException } from '@nestjs/common';
import {
  CompanyRegistryRecord,
  CompanyRegistryService,
} from './company-registry.service';
import { verifyRepresentative } from './representatives';

/** Quem contrata e quem responde pela empresa, já conferidos. */
export interface ResolvedContractor {
  type: 'PF' | 'PJ';
  document: string;
  name: string;
  tradeName: string | null;
  email: string;
  representative: {
    cpf: string;
    name: string;
    verified: boolean;
    isSessionUser: boolean;
  } | null;
  registrySnapshot: Record<string, any> | null;
}

/**
 * A conferência do CPF do representante enquanto a pessoa preenche: o
 * veredito, nunca o quadro societário. CPF fora do quadro é recusado ali
 * mesmo; base pública fora do ar pede o nome e segue sem conferência.
 */
export async function checkRepresentative(
  registry: CompanyRegistryService,
  cnpj: string,
  cpf: string,
) {
  const record = await registry.lookup(cnpj).catch(() => null);
  if (!record) {
    return { registryAvailable: false, verified: false, requiresName: true };
  }
  const verdict = verifyRepresentative(record.partners, cpf);
  if (verdict.status === 'NOT_IN_REGISTRY') {
    throw new UnprocessableEntityException({
      code: 'REPRESENTATIVE_NOT_IN_REGISTRY',
      message:
        'Este CPF não consta como representante legal desta empresa no registro público.',
    });
  }
  if (verdict.status === 'VERIFIED') {
    return {
      registryAvailable: true,
      verified: true,
      requiresName: false,
      representativeName: verdict.name,
      qualification: verdict.qualification,
    };
  }
  return { registryAvailable: true, verified: false, requiresName: true };
}

export interface CompanyContractorInput {
  cnpj: string;
  email: string;
  /** Usados só quando a consulta pública não responde. */
  legalName?: string | null;
  tradeName?: string | null;
  representative?: {
    cpf: string;
    name?: string | null;
    isSelf: boolean;
  } | null;
}

/**
 * A empresa que contrata, confirmada pela consulta pública do CNPJ, e o CPF de
 * quem responde por ela conferido contra o quadro societário quando ele existe
 * — não conferindo, nada segue. Sem quadro para conferir, o CPF é aceito com o
 * nome informado, e o aceite registra que não houve conferência.
 *
 * É a mesma regra na contratação e no aceite de uma transferência de
 * titularidade: nos dois, alguém passa a responder pela assinatura.
 */
export async function resolveCompanyContractor(
  registry: CompanyRegistryService,
  logger: Logger,
  input: CompanyContractorInput,
): Promise<{
  contractor: ResolvedContractor;
  record: CompanyRegistryRecord | null;
}> {
  const cnpj = String(input.cnpj).replace(/\D/g, '');
  const rep = input.representative;
  if (!rep) {
    throw new UnprocessableEntityException({
      code: 'REPRESENTATIVE_REQUIRED',
      message: 'Informe o CPF de quem responde legalmente pela empresa.',
    });
  }

  let record: CompanyRegistryRecord | null = null;
  try {
    record = await registry.lookup(cnpj);
  } catch (error) {
    // Base pública fora do ar não impede a contratação: segue com os dados
    // informados, sem conferência.
    logger.warn(`CNPJ ${cnpj} sem consulta: ${error.message}`);
  }

  const legalName = record?.legalName ?? input.legalName?.trim();
  if (!legalName) {
    throw new UnprocessableEntityException({
      code: 'LEGAL_NAME_REQUIRED',
      message: 'Informe a razão social da empresa.',
    });
  }

  const cpf = rep.cpf.replace(/\D/g, '');
  const verdict = record
    ? verifyRepresentative(record.partners, cpf)
    : ({ status: 'UNVERIFIABLE' } as const);

  if (verdict.status === 'NOT_IN_REGISTRY') {
    throw new UnprocessableEntityException({
      code: 'REPRESENTATIVE_NOT_IN_REGISTRY',
      message:
        'Este CPF não consta como representante legal desta empresa no registro público.',
    });
  }

  let representativeName: string;
  if (verdict.status === 'VERIFIED') {
    // O nome é o que o registro publica, não o que a pessoa digitaria.
    representativeName = verdict.name;
  } else {
    representativeName = rep.name?.trim() ?? '';
    if (representativeName.length < 2) {
      throw new UnprocessableEntityException({
        code: 'REPRESENTATIVE_NAME_REQUIRED',
        message: 'Informe o nome de quem responde legalmente pela empresa.',
      });
    }
  }

  return {
    record,
    contractor: {
      type: 'PJ',
      document: cnpj,
      name: legalName,
      tradeName: record?.tradeName ?? input.tradeName?.trim() ?? null,
      email: input.email.trim().toLowerCase(),
      representative: {
        cpf,
        name: representativeName,
        verified: verdict.status === 'VERIFIED',
        isSessionUser: rep.isSelf,
      },
      // Só o que sustentou a conferência — não o quadro inteiro.
      registrySnapshot: record
        ? {
            source: 'brasilapi',
            fetchedAt: record.fetchedAt,
            legalName: record.legalName,
            registrationStatus: record.registrationStatus,
            verification: verdict.status,
            ...(verdict.status === 'VERIFIED'
              ? { qualification: verdict.qualification }
              : {}),
          }
        : { source: 'none', verification: 'UNVERIFIABLE' },
    },
  };
}
