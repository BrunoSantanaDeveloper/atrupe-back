import { ConflictException } from '@nestjs/common';
import {
  claimStorageKey,
  discardUnregistered,
  isStorageKeyOf,
  KEY_ALREADY_SAVED,
  newStorageKey,
  storageKeyRegistered,
} from './storage-key';

const FOLDER = 'production/c1/t1';
const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e';

const db = (found: { version?: boolean; order?: boolean } = {}) => ({
  $executeRaw: jest.fn().mockResolvedValue(1),
  productionAttachmentVersion: {
    findFirst: jest.fn().mockResolvedValue(found.version ? { id: 'v1' } : null),
  },
  orderFile: {
    findFirst: jest.fn().mockResolvedValue(found.order ? { id: 'f1' } : null),
  },
});

describe('a chave do arquivo no armazenamento', () => {
  it('a chave nova tem o formato que o envio direto confere', () => {
    const key = newStorageKey(FOLDER, 'arte-final.pdf');
    expect(key.startsWith(`${FOLDER}/`)).toBe(true);
    expect(isStorageKeyOf(key, FOLDER, 'arte-final.pdf')).toBe(true);
  });

  it('recusa outra pasta, outro nome, `..`, `//` e o que foge do formato', () => {
    expect(
      isStorageKeyOf(`${FOLDER}/${UUID}-arte.pdf`, FOLDER, 'arte.pdf'),
    ).toBe(true);
    for (const key of [
      `production/c1/t2/${UUID}-arte.pdf`,
      `production/c2/t1/${UUID}-arte.pdf`,
      `orders/c1/t1/${UUID}-arte.pdf`,
      `${FOLDER}/${UUID}-outra.pdf`,
      `${FOLDER}/${UUID}-arteXpdf`,
      `${FOLDER}/../t2/${UUID}-arte.pdf`,
      `${FOLDER}//${UUID}-arte.pdf`,
      `${FOLDER}/x/${UUID}-arte.pdf`,
      `${FOLDER}/${UUID}-arte.pdf/..`,
      `${FOLDER}/arte.pdf`,
      `${FOLDER}/${UUID.toUpperCase()}-arte.pdf`,
      ` ${FOLDER}/${UUID}-arte.pdf`,
      `${FOLDER}/${UUID}-arte.pdf\n`,
    ]) {
      expect(isStorageKeyOf(key, FOLDER, 'arte.pdf')).toBe(false);
    }
  });

  it('a chave registrada num anexo ou num arquivo de O.S.', async () => {
    await expect(storageKeyRegistered(db() as never, 'k')).resolves.toBe(false);
    await expect(
      storageKeyRegistered(db({ version: true }) as never, 'k'),
    ).resolves.toBe(true);
    await expect(
      storageKeyRegistered(db({ order: true }) as never, 'k'),
    ).resolves.toBe(true);
  });

  it('o registro trava a chave e recusa a já registrada', async () => {
    const free = db();
    await claimStorageKey(free as never, 'k');
    expect(free.$executeRaw).toHaveBeenCalled();

    const taken = db({ version: true });
    await expect(claimStorageKey(taken as never, 'k')).rejects.toThrow(
      new ConflictException(KEY_ALREADY_SAVED),
    );
  });

  it('o arquivo recusado só sai do armazenamento sem registro', async () => {
    const run = async (tx: ReturnType<typeof db>, remove: jest.Mock) => {
      const prisma = { $transaction: (fn: (t: unknown) => unknown) => fn(tx) };
      await discardUnregistered(prisma as never, 'k', remove);
    };

    const free = jest.fn().mockResolvedValue(undefined);
    await run(db(), free);
    expect(free).toHaveBeenCalledWith('k');

    const taken = jest.fn();
    await run(db({ order: true }), taken);
    expect(taken).not.toHaveBeenCalled();

    // A falha ao apagar não troca a recusa por outro erro
    const failing = jest.fn().mockRejectedValue(new Error('S3 fora'));
    await expect(run(db(), failing)).resolves.toBeUndefined();
  });
});
