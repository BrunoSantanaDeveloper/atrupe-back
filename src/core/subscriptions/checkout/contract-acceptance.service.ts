import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { ContractService } from '../../contract/contract.service';

export type AcceptanceContext =
  | 'NEW_CONTRACT'
  | 'REGULARIZATION'
  | 'EVOLUTION'
  | 'COMPLEMENTS'
  | 'OWNERSHIP_TRANSFER';

export interface CurrentTerms {
  id: string;
  name: string;
  version: number;
  html: string;
  sha256: string;
}

export interface AcceptanceInput {
  terms: CurrentTerms;
  companyId: string;
  subscriptionId: string | null;
  context: AcceptanceContext;
  acceptedBy: { userId: string; name: string; email: string };
  contractor: {
    type: 'PF' | 'PJ';
    document: string;
    name: string;
    tradeName?: string | null;
    email: string;
  };
  representative?: {
    cpf: string;
    name: string;
    verified: boolean;
    isSessionUser: boolean;
  } | null;
  /**
   * O Administrador Principal da Conta (Usuário nº 1) que a contratante indica
   * ao aceitar (contrato 1.1, 1.5 e 4.1). Só na contratação nova.
   */
  principalAdmin?: { userId: string; name: string; email: string } | null;
  /** O mínimo do registro público que sustentou a conferência. */
  registrySnapshot?: Record<string, any> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * O aceite do contrato na contratação.
 *
 * Guarda o que o aceite precisa provar depois: a versão e o hash exato do
 * texto aceito, quem aceitou, em nome de quem (o contratante), quem
 * respondeu legalmente pela empresa e se isso foi conferido contra o registro
 * público — um aceite conferido e um não conferido não podem ficar
 * indistinguíveis. A hora é a do servidor, não a do navegador.
 */
@Injectable()
export class ContractAcceptanceService {
  constructor(private readonly contractService: ContractService) {}

  async currentTerms(): Promise<CurrentTerms> {
    const terms = await this.contractService.getCurrentTerms();
    if (!terms) {
      throw new ServiceUnavailableException(
        'Os Termos de Contratação não estão disponíveis no momento.',
      );
    }
    return {
      ...terms,
      sha256: createHash('sha256').update(terms.html, 'utf8').digest('hex'),
    };
  }

  /** Grava o aceite dentro da transação de quem contrata. */
  async record(tx: Prisma.TransactionClient, input: AcceptanceInput) {
    const acceptance = await tx.contractAcceptance.create({
      data: {
        contractId: input.terms.id,
        contractVersion: input.terms.version,
        termsSha256: input.terms.sha256,
        companyId: input.companyId,
        subscriptionId: input.subscriptionId,
        context: input.context,
        acceptedByUserId: input.acceptedBy.userId,
        acceptedByName: input.acceptedBy.name,
        acceptedByEmail: input.acceptedBy.email,
        contractorType: input.contractor.type,
        contractorDocument: input.contractor.document,
        contractorName: input.contractor.name,
        contractorTradeName: input.contractor.tradeName ?? null,
        contractorEmail: input.contractor.email,
        representativeCpf: input.representative?.cpf ?? null,
        representativeName: input.representative?.name ?? null,
        representativeVerified: input.representative
          ? input.representative.verified
          : null,
        representativeIsSessionUser:
          input.representative?.isSessionUser ?? false,
        principalAdminUserId: input.principalAdmin?.userId ?? null,
        principalAdminName: input.principalAdmin?.name ?? null,
        principalAdminEmail: input.principalAdmin?.email ?? null,
        registrySnapshot: (input.registrySnapshot ?? undefined) as any,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });

    // O modal "Contrato de Assinatura" lê o aceite por usuário e versão;
    // mantê-lo em dia evita que ele diga que não há contrato aceito.
    await tx.userContract.upsert({
      where: {
        userId_contractId: {
          userId: input.acceptedBy.userId,
          contractId: input.terms.id,
        },
      },
      create: {
        userId: input.acceptedBy.userId,
        contractId: input.terms.id,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
      update: {},
    });

    return {
      id: acceptance.id,
      acceptedAt: acceptance.createdAt,
      version: acceptance.contractVersion,
      representativeVerified: acceptance.representativeVerified,
    };
  }
}
