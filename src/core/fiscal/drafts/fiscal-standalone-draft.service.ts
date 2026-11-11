import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { FiscalDocType } from '@prisma/client';

import { PrismaService } from '../../../config/prisma/prisma.service';
import {
  DocTypeRascunho,
  SaveStandaloneDraftDto,
} from './dtos/standalone-draft.dto';

/**
 * Rascunho de nota avulsa (NF-e, NFS-e e NFC-e).
 *
 * Nenhuma das tres telas avulsas gravava nada: sair da pagina perdia o que
 * tinha sido digitado. O rascunho vive em tabela propria porque nao e'
 * documento fiscal — e porque em `nfces` seria impossivel, ja' que o unique de
 * (empresa, numero, serie, ambiente) faria dois rascunhos colidirem entre si.
 *
 * O `payload` e' opaco de proposito: e' o corpo do formulario como ele seria
 * enviado na emissao. Validar aqui so' impediria de guardar justamente o que
 * ainda esta' incompleto.
 */
@Injectable()
export class FiscalStandaloneDraftService {
  private readonly logger = new Logger(FiscalStandaloneDraftService.name);

  constructor(private readonly prisma: PrismaService) {}

  async save(
    companyId: string,
    dto: SaveStandaloneDraftDto,
    autor?: { id?: string; name?: string },
  ) {
    const dados = {
      docType: dto.docType as FiscalDocType,
      description: dto.description?.trim() || null,
      totalValue: dto.totalValue ?? 0,
      payload: dto.payload as any,
    };

    if (dto.id) {
      // updateMany com companyId no where: `update` por id sozinho aceitaria
      // o rascunho de outra empresa.
      const { count } = await this.prisma.fiscalStandaloneDraft.updateMany({
        where: { id: dto.id, companyId },
        data: dados,
      });
      if (count === 0) {
        throw new NotFoundException('Rascunho não encontrado.');
      }
      return this.findOne(companyId, dto.id);
    }

    const criado = await this.prisma.fiscalStandaloneDraft.create({
      data: {
        ...dados,
        companyId,
        createdBy: autor?.id || null,
        createdByName: autor?.name || null,
      },
    });

    this.logger.log(
      `Rascunho de ${dto.docType} criado: ${criado.id} (empresa ${companyId})`,
    );

    return criado;
  }

  async findOne(companyId: string, id: string) {
    const rascunho = await this.prisma.fiscalStandaloneDraft.findFirst({
      where: { id, companyId },
    });
    if (!rascunho) {
      throw new NotFoundException('Rascunho não encontrado.');
    }
    return rascunho;
  }

  async list(companyId: string, docType?: DocTypeRascunho) {
    return this.prisma.fiscalStandaloneDraft.findMany({
      where: {
        companyId,
        ...(docType ? { docType: docType as FiscalDocType } : {}),
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /**
   * Some com o rascunho. Chamado tambem pela tela depois de emitir: o que
   * virou nota nao pode continuar aparecendo como "em digitacao".
   */
  async remove(companyId: string, id: string) {
    const { count } = await this.prisma.fiscalStandaloneDraft.deleteMany({
      where: { id, companyId },
    });
    if (count === 0) {
      throw new NotFoundException('Rascunho não encontrado.');
    }
    return { deleted: true };
  }
}
