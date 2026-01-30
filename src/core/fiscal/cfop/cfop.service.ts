import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { CreateCfopDto, UpdateCfopDto } from './cfop.dto';

@Injectable()
export class CfopService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Listar todos os CFOPs de uma empresa
   */
  async getAll(companyId: string) {
    return this.prisma.cfopConfig.findMany({
      where: { companyId },
      orderBy: [{ type: 'asc' }, { code: 'asc' }],
    });
  }

  /**
   * Obter CFOP por ID
   */
  async getById(id: string) {
    const cfop = await this.prisma.cfopConfig.findUnique({
      where: { id },
    });

    if (!cfop) {
      throw new NotFoundException('CFOP não encontrado');
    }

    return cfop;
  }

  /**
   * Criar novo CFOP
   */
  async create(companyId: string, dto: CreateCfopDto) {
    // Verificar se já existe CFOP com mesmo código na empresa
    const existing = await this.prisma.cfopConfig.findFirst({
      where: { companyId, code: dto.code },
    });

    if (existing) {
      throw new ConflictException(
        `Já existe um CFOP com o código "${dto.code}" nesta empresa`,
      );
    }

    return this.prisma.cfopConfig.create({
      data: {
        ...dto,
        companyId,
      },
    });
  }

  /**
   * Atualizar CFOP
   */
  async update(id: string, dto: UpdateCfopDto) {
    const cfop = await this.prisma.cfopConfig.findUnique({
      where: { id },
    });

    if (!cfop) {
      throw new NotFoundException('CFOP não encontrado');
    }

    // Se está alterando o código, verificar duplicidade
    if (dto.code && dto.code !== cfop.code) {
      const existing = await this.prisma.cfopConfig.findFirst({
        where: { companyId: cfop.companyId, code: dto.code, id: { not: id } },
      });

      if (existing) {
        throw new ConflictException(
          `Já existe um CFOP com o código "${dto.code}" nesta empresa`,
        );
      }
    }

    return this.prisma.cfopConfig.update({
      where: { id },
      data: dto,
    });
  }

  /**
   * Excluir CFOP
   */
  async delete(id: string) {
    const cfop = await this.prisma.cfopConfig.findUnique({
      where: { id },
    });

    if (!cfop) {
      throw new NotFoundException('CFOP não encontrado');
    }

    await this.prisma.cfopConfig.delete({
      where: { id },
    });

    return { success: true };
  }

  /**
   * Listar CFOPs ativos de uma empresa
   */
  async getActive(companyId: string) {
    return this.prisma.cfopConfig.findMany({
      where: { companyId, isActive: true },
      orderBy: [{ type: 'asc' }, { code: 'asc' }],
    });
  }
}
