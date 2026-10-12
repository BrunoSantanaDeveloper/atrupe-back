import { NotFoundException } from '@nestjs/common';
import { ContactSourceService } from './contact-source.service';

/**
 * Ocultar valia para qualquer origem: a privada de outra empresa ganhava um
 * vínculo que impedia a dona de excluí-la.
 */
describe('Origem de contato: ocultar', () => {
  const prisma = {
    contactSource: { findUnique: jest.fn() },
    companyHiddenContactSource: { upsert: jest.fn() },
  };
  const service = new ContactSourceService(prisma as any);

  beforeEach(() => jest.clearAllMocks());

  it('a origem privada de outra empresa responde 404, sem gravar', async () => {
    prisma.contactSource.findUnique.mockResolvedValue({
      id: 'origem-b',
      companyId: 'empresa-b',
    });

    await expect(service.hide('origem-b', 'empresa-a')).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.companyHiddenContactSource.upsert).not.toHaveBeenCalled();
  });

  it('a origem global é ocultada para a empresa', async () => {
    prisma.contactSource.findUnique.mockResolvedValue({
      id: 'origem-global',
      companyId: null,
    });

    await service.hide('origem-global', 'empresa-a');
    expect(prisma.companyHiddenContactSource.upsert).toHaveBeenCalled();
  });
});
