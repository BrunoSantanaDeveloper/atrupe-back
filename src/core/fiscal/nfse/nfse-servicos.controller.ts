import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PrismaService } from 'nestjs-prisma';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { PermissionsGuard } from '../../auth/abac/permissions.guard';
import { HasPermission } from '../../auth/abac/has-permission.decorator';
import { NfseServicoDto } from './dtos/nfse-servico.dto';

/**
 * Lista de serviços da empresa para NFS-e — espelha a "Lista de Serviços" do
 * InvoiCy Web: várias combinações de código LC 116 + classificação fiscal,
 * escolhidas no ato da emissão.
 *
 * Controller próprio (rota /fiscal/nfse-servicos) para não disputar com o
 * @Get(':id') do NfseController.
 */
@ApiTags('Fiscal - Lista de Serviços NFS-e')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('fiscal/nfse-servicos')
export class NfseServicosController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @HasPermission('view', 'nota_fiscal:emitir')
  @ApiOperation({ summary: 'Listar serviços cadastrados da empresa' })
  async findAll(@Req() req) {
    return this.prisma.nfseServico.findMany({
      where: { companyId: req.user.companyId },
      orderBy: [{ isDefault: 'desc' }, { codigo: 'asc' }],
    });
  }

  @Post()
  @HasPermission('edit', 'nota_fiscal:config')
  @ApiOperation({ summary: 'Cadastrar serviço na lista' })
  async create(@Req() req, @Body() dto: NfseServicoDto) {
    if (dto.isDefault) {
      await this.limparPadrao(req.user.companyId);
    }
    return this.prisma.nfseServico.create({
      data: { ...dto, companyId: req.user.companyId },
    });
  }

  @Put(':id')
  @HasPermission('edit', 'nota_fiscal:config')
  @ApiOperation({ summary: 'Atualizar serviço da lista' })
  async update(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: NfseServicoDto,
  ) {
    await this.exigirDaEmpresa(id, req.user.companyId);
    if (dto.isDefault) {
      await this.limparPadrao(req.user.companyId);
    }
    return this.prisma.nfseServico.update({ where: { id }, data: dto });
  }

  @Delete(':id')
  @HasPermission('edit', 'nota_fiscal:config')
  @ApiOperation({ summary: 'Remover serviço da lista' })
  async remove(@Req() req, @Param('id') id: string) {
    await this.exigirDaEmpresa(id, req.user.companyId);
    return this.prisma.nfseServico.delete({ where: { id } });
  }

  /** Multi-tenant: nunca tocar registro de outra empresa. */
  private async exigirDaEmpresa(id: string, companyId: string) {
    const existente = await this.prisma.nfseServico.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!existente) {
      throw new NotFoundException('Serviço não encontrado');
    }
  }

  private async limparPadrao(companyId: string) {
    await this.prisma.nfseServico.updateMany({
      where: { companyId, isDefault: true },
      data: { isDefault: false },
    });
  }
}
