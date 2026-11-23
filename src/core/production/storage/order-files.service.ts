import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { AbacService } from '../../auth/abac/abac.service';
import { ATTACHMENT_MAX_BYTES, nameOf } from '../production-task.service';
import { ProductionFilesService, refusalOf } from './production-files.service';
import { ProductionStorageService } from './production-storage.service';
import {
  claimStorageKey,
  discardUnregistered,
  isStorageKeyOf,
  KEY_ALREADY_SAVED,
  newStorageKey,
  storageKeyRegistered,
} from './storage-key';

export const ORDER_NOT_FOUND = 'Ordem de serviço não encontrada';

type User = {
  userId?: string;
  companyId: string;
  employeeId?: string | null;
  isAdmin?: boolean;
  name?: string;
};

type Upload = {
  originalname: string;
  mimetype?: string;
  size: number;
  buffer: Buffer;
};

/**
 * Os arquivos da O.S. (GP-49, 22/11/2026): a O.S. geral guarda arquivos de
 * qualquer formato aceito (imagem, PDF, AI, CDR, TIFF, DXF, ZIP), com a
 * intenção maior de armazenar. Vê quem vê a O.S. (o vendedor sem acesso aos
 * outros só vê as suas); acrescenta e apaga quem edita a O.S. Contam no
 * espaço dos arquivos e entram na limpeza da O.S. entregue (finalizada).
 */
@Injectable()
export class OrderFilesService {
  private readonly logger = new Logger(OrderFilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly abac: AbacService,
    private readonly files: ProductionFilesService,
    private readonly storage: ProductionStorageService,
  ) {}

  /** A O.S. da empresa que o usuário vê; sem ela, "não encontrada". */
  private async order(user: User, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, quotation: { companyId: user.companyId } },
      select: { id: true, quotation: { select: { sellerId: true } } },
    });
    if (!order) throw new NotFoundException(ORDER_NOT_FOUND);
    if (!user.isAdmin && user.employeeId) {
      const others = await this.abac.canAccessOtherSellers(user as never);
      if (!others && order.quotation.sellerId !== user.employeeId) {
        throw new NotFoundException(ORDER_NOT_FOUND);
      }
    }
    return order;
  }

  private async uploaderName(user: User) {
    if (user.name) return user.name;
    const row = user.userId
      ? await this.prisma.user.findUnique({
          where: { id: user.userId },
          select: { name: true },
        })
      : null;
    return row?.name || 'Usuário';
  }

  async list(user: User, orderId: string) {
    await this.order(user, orderId);
    const rows = await this.prisma.orderFile.findMany({
      where: { orderId },
      orderBy: { uploadedAt: 'desc' },
    });
    const now = new Date();
    const storage = await this.files.summary(
      user.companyId,
      this.storage.configured(),
    );
    return {
      storage,
      files: rows.map((row) => ({
        id: row.id,
        fileName: row.fileName,
        size: row.size,
        mime: row.mime,
        uploadedBy: row.uploadedBy,
        uploadedAt: row.uploadedAt.toISOString(),
        removedAt: row.removedAt?.toISOString() ?? null,
        url: row.removedAt ? null : this.storage.signedUrl(row.storageKey, now),
      })),
    };
  }

  private folderOf(user: User, orderId: string) {
    return `orders/${user.companyId}/${orderId}`;
  }

  private keyOf(user: User, orderId: string, safeName: string) {
    return newStorageKey(this.folderOf(user, orderId), safeName);
  }

  /** Grava a linha com a chave travada: a mesma chave não entra duas vezes. */
  private async create(
    user: User,
    orderId: string,
    file: { fileName: string; mime: string; size: number; storageKey: string },
  ) {
    const uploadedBy = await this.uploaderName(user);
    await this.prisma.$transaction(async (tx) => {
      await claimStorageKey(tx, file.storageKey);
      await tx.orderFile.create({
        data: {
          companyId: user.companyId,
          orderId,
          ...file,
          uploadedById: user.userId ?? null,
          uploadedBy,
        },
      });
    });
    return this.list(user, orderId);
  }

  /** O arquivo pelo servidor (até 20 MB). */
  async add(user: User, orderId: string, upload?: Upload) {
    await this.order(user, orderId);
    if (!upload?.originalname || !upload.buffer?.length) {
      throw new BadRequestException('Escolha o arquivo');
    }
    if (upload.size > ATTACHMENT_MAX_BYTES) {
      throw new BadRequestException('O arquivo passa de 20 MB');
    }
    const name = nameOf(upload.originalname);
    const summary = await this.files.summary(user.companyId, false);
    this.files.assertFits(summary, upload.size);
    const mime =
      upload.mimetype && upload.mimetype !== 'application/octet-stream'
        ? upload.mimetype
        : name.mime;
    const key = this.keyOf(user, orderId, name.safeName);
    await this.storage.put(key, upload.buffer, mime);
    return this.create(user, orderId, {
      fileName: name.fileName,
      mime,
      size: upload.size,
      storageKey: key,
    });
  }

  /** O link para o navegador enviar direto ao armazenamento. */
  async uploadLink(
    user: User,
    orderId: string,
    dto: { fileName: string; size: number },
  ) {
    await this.order(user, orderId);
    const name = nameOf(dto.fileName);
    this.files.assertFits(
      await this.files.summary(user.companyId, this.storage.configured()),
      dto.size,
    );
    const key = this.keyOf(user, orderId, name.safeName);
    // O PUT precisa mandar este mime como Content-Type (vai na assinatura)
    return {
      key,
      url: this.storage.uploadUrl(key, dto.size, name.mime),
      mime: name.mime,
    };
  }

  /**
   * O arquivo que o navegador enviou: confere a chave (o formato que o link
   * gerou, desta O.S. e deste nome, ainda sem registro), o tamanho e o
   * espaço. O tipo é o do link, que o armazenamento já exigiu no envio.
   */
  async addDirect(
    user: User,
    orderId: string,
    dto: { key: string; fileName: string; mime?: string },
  ) {
    await this.order(user, orderId);
    const name = nameOf(dto.fileName);
    if (!isStorageKeyOf(dto.key, this.folderOf(user, orderId), name.safeName)) {
      throw new BadRequestException(
        'Arquivo inválido para esta O.S. Envie de novo.',
      );
    }
    if (await storageKeyRegistered(this.prisma, dto.key)) {
      throw new ConflictException(KEY_ALREADY_SAVED);
    }
    const size = await this.storage.sizeOf(dto.key);
    if (size === null) {
      throw new BadRequestException(
        'O arquivo não chegou ao armazenamento. Envie de novo.',
      );
    }
    const summary = await this.files.summary(
      user.companyId,
      this.storage.configured(),
    );
    const refusal = refusalOf(summary, size);
    if (refusal) {
      await discardUnregistered(this.prisma, dto.key, (key) =>
        this.storage.remove(key),
      );
      throw new UnprocessableEntityException(refusal);
    }
    return this.create(user, orderId, {
      fileName: name.fileName,
      mime: name.mime,
      size,
      storageKey: dto.key,
    });
  }

  async remove(user: User, orderId: string, fileId: string) {
    await this.order(user, orderId);
    const row = await this.prisma.orderFile.findFirst({
      where: { id: fileId, orderId },
      select: { id: true, storageKey: true, removedAt: true },
    });
    if (!row) throw new NotFoundException('Arquivo não encontrado');
    await this.prisma.orderFile.delete({ where: { id: row.id } });
    // A chave que ainda está noutro registro (dado de antes da chave única)
    // não perde o arquivo
    if (
      !row.removedAt &&
      !(await storageKeyRegistered(this.prisma, row.storageKey))
    ) {
      await this.storage
        .remove(row.storageKey)
        .catch((error) =>
          this.logger.warn(
            `Arquivo não apagado (${row.storageKey}): ${error.message}`,
          ),
        );
    }
    return this.list(user, orderId);
  }
}
