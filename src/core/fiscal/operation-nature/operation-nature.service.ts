import {
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { CreateOperationNatureDto, UpdateOperationNatureDto } from './operation-nature.dto';

@Injectable()
export class OperationNatureService {
    constructor(private readonly prisma: PrismaService) { }

    /**
     * Listar todas as Naturezas de Operação de uma empresa
     */
    async getAll(companyId: string) {
        return this.prisma.operationNature.findMany({
            where: { companyId },
            include: {
                cfopInternal: true,
                cfopExternal: true,
            },
            orderBy: { description: 'asc' },
        });
    }

    /**
     * Obter Natureza por ID
     */
    async getById(id: string) {
        const nature = await this.prisma.operationNature.findUnique({
            where: { id },
            include: {
                cfopInternal: true,
                cfopExternal: true,
            },
        });

        if (!nature) {
            throw new NotFoundException('Natureza de Operação não encontrada');
        }

        return nature;
    }

    /**
     * Criar nova Natureza
     */
    async create(companyId: string, dto: CreateOperationNatureDto) {
        return this.prisma.operationNature.create({
            data: {
                ...dto,
                companyId,
            },
            include: {
                cfopInternal: true,
                cfopExternal: true,
            },
        });
    }

    /**
     * Atualizar Natureza
     */
    async update(id: string, dto: UpdateOperationNatureDto) {
        const nature = await this.prisma.operationNature.findUnique({
            where: { id },
        });

        if (!nature) {
            throw new NotFoundException('Natureza de Operação não encontrada');
        }

        return this.prisma.operationNature.update({
            where: { id },
            data: dto,
            include: {
                cfopInternal: true,
                cfopExternal: true,
            },
        });
    }

    /**
     * Excluir Natureza
     */
    async delete(id: string) {
        const nature = await this.prisma.operationNature.findUnique({
            where: { id },
        });

        if (!nature) {
            throw new NotFoundException('Natureza de Operação não encontrada');
        }

        await this.prisma.operationNature.delete({
            where: { id },
        });

        return { success: true };
    }
}
