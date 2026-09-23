import {
  CanActivate,
  ConflictException,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from 'src/config/prisma/prisma.service';
import {
  isHistoricalDocument,
  loadFiscalHistoryLock,
} from './fiscal-history-lock';

export type FiscalDocumentKind = 'nfe' | 'nfse' | 'nfce';

const FISCAL_DOCUMENT_ACTION = 'fiscalDocumentAction';

interface FiscalDocumentAction {
  kind: FiscalDocumentKind;
  /** Onde está o id da nota: um parâmetro da rota ou um campo do corpo. */
  from: { param: string } | { body: string };
}

/**
 * A rota mexe numa nota já emitida. Nota do CNPJ anterior a uma transferência
 * de titularidade não passa: fica só para consulta (FiscalHistoryLockGuard).
 */
export const ActsOnIssuedDocument = (
  kind: FiscalDocumentKind,
  from: FiscalDocumentAction['from'] = { param: 'id' },
) => SetMetadata(FISCAL_DOCUMENT_ACTION, { kind, from });

/**
 * Recusa, com o motivo, a manipulação de uma nota emitida sob o CNPJ anterior
 * a uma transferência de titularidade (cancelar, corrigir, reemitir, reenviar,
 * consultar no provedor). Sem troca de CNPJ na empresa, não consulta nada além
 * da própria empresa.
 */
@Injectable()
export class FiscalHistoryLockGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const action = this.reflector.get<FiscalDocumentAction>(
      FISCAL_DOCUMENT_ACTION,
      context.getHandler(),
    );
    if (!action) return true;

    const request = context.switchToHttp().getRequest();
    const companyId: string | undefined = request.user?.companyId;
    const documentId: string | undefined =
      'param' in action.from
        ? request.params?.[action.from.param]
        : request.body?.[action.from.body];
    if (!companyId || !documentId) return true;

    const lock = await loadFiscalHistoryLock(this.prisma, companyId);
    if (!lock) return true;

    const document = await this.findDocument(
      action.kind,
      documentId,
      companyId,
    );
    if (document && isHistoricalDocument(document, lock)) {
      throw new ConflictException({
        code: 'FISCAL_DOCUMENT_LOCKED',
        message: lock.reason,
      });
    }
    return true;
  }

  private findDocument(
    kind: FiscalDocumentKind,
    id: string,
    companyId: string,
  ): Promise<{ createdAt: Date; invoicyConfigId: string | null } | null> {
    const args = {
      where: { id, companyId },
      select: { createdAt: true, invoicyConfigId: true },
    };
    switch (kind) {
      case 'nfe':
        return this.prisma.nfe.findFirst(args);
      case 'nfse':
        return this.prisma.nfse.findFirst(args);
      case 'nfce':
        return this.prisma.nfce.findFirst(args);
    }
  }
}
