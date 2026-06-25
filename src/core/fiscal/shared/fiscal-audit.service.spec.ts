import { BadRequestException } from '@nestjs/common';
import {
  ActorType,
  FiscalConfigAction,
  FiscalEnvironment,
} from '@prisma/client';
import { FiscalAuditService } from './fiscal-audit.service';

describe('FiscalAuditService', () => {
  it('registra falha classificada sem persistir a mensagem bruta', async () => {
    const create = jest.fn().mockResolvedValue({});
    const service = new FiscalAuditService({
      invoicyConfigHistory: { create },
    } as any);

    await service.recordFailedAction(
      {
        companyId: 'company-1',
        invoicyConfigId: 'config-1',
        emissorName: 'Matriz',
        action: FiscalConfigAction.CREDENTIALS_ROTATE,
        actorType: ActorType.USER,
        createdBy: 'user-1',
        createdByName: 'Usuário',
        environment: FiscalEnvironment.HOMOLOGACAO,
        description: 'Access key configurada',
      },
      new BadRequestException('Access key rejeitada: secret-value'),
    );

    const data = create.mock.calls[0][0].data;
    expect(data.result).toBe('FAILED');
    expect(data.metadata.errorCode).toBe('PROVIDER_AUTH_ERROR');
    expect(JSON.stringify(data)).not.toContain('secret-value');
  });
});
