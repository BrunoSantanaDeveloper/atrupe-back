import { HasPermission } from 'src/core/auth/abac/has-permission.decorator';
import { ObservePermissions } from 'src/core/auth/abac/observe-permissions.decorator';
import {
  PermissionsGuard,
  permissionDenied,
} from 'src/core/auth/abac/permissions.guard';
import { AbacService } from 'src/core/auth/abac/abac.service';
import {
  VALUES_PERMISSION,
  canViewValues,
  omitMoneyFields,
} from 'src/core/auth/abac/values-visibility.interceptor';
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Req,
  Query,
  Request,
} from '@nestjs/common';
import { SectorService } from './sector.service';
import { CreateSectorDto } from './dto/create-sector.dto';
import { UpdateSectorDto } from './dto/update-sector.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { FeatureGuard } from '../plan/guards/feature.guard';
import { RequiresFeature } from '../plan/decorators/requires-feature.decorator';
import { PlanControlService } from '../plan/plan-control.service';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { SectorFilterDto } from './dto/filter.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { TenantGuard } from 'src/core/auth/guards/tenant.guard';
import { TenantResource } from 'src/core/auth/guards/tenant-resource.decorator';

const RESOURCE = 'sector';
// Custo e venda da hora do setor (composição): campos novos, a regra de
// valores vale já, sem modo observar
const SECTOR_MONEY_FIELDS = new Set(['hourCost', 'hourSale']);

@ApiTags('Setores')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@ApiBearerAuth()
// Permissão no endpoint em modo observar (Fase 2): a recusa vai para o log
// sem recusar, até a semana de log limpo; handler com
// @ObservePermissions(false) já recusa.
@ObservePermissions()
@Controller(RESOURCE)
export class SectorController {
  constructor(
    private readonly sectorService: SectorService,
    private readonly planControl: PlanControlService,
    private readonly prisma: PrismaService,
    private readonly abacService: AbacService,
  ) {}

  private async withValues<T>(req: any, body: T): Promise<T> {
    return (await canViewValues(req, this.abacService))
      ? body
      : omitMoneyFields(body, SECTOR_MONEY_FIELDS);
  }

  // Listar setores é livre: produtos, colaboradores e a agenda usam. Criar,
  // editar e excluir é o recurso "Configurar Setores" do plano.

  @Post()
  @HasPermission('create', 'company_settings:sectors')
  @UseGuards(FeatureGuard)
  @RequiresFeature('sectors_configuration')
  @ApiOperation({ summary: 'Cria um novo setor' })
  @ApiBody({
    description: 'Dados do novo setor',
    type: CreateSectorDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Setor criado com sucesso.',
  })
  async create(@Request() req, @Body() createSectorDto: CreateSectorDto) {
    createSectorDto.companyId = req.user.companyId;
    return this.withValues(
      req,
      await this.sectorService.create(createSectorDto),
    );
  }

  @Get()
  @ApiOperation({ summary: 'Obtém a lista de todos os setores' })
  @ApiResponse({
    status: 200,
    description: 'Lista de setores retornada com sucesso.',
    isArray: true,
  })
  async findAll(@Req() req, @Query() filter: SectorFilterDto) {
    filter.companyId = req.user.companyId;
    return this.withValues(req, await this.sectorService.findAll(filter));
  }

  @Get('with-products')
  @HasPermission('view', 'sale:quotation')
  @ApiOperation({ summary: 'Obtém a lista de todos os setores com produtos' })
  @ApiResponse({
    status: 200,
    description: 'Lista de setores retornada com sucesso.',
    isArray: true,
  })
  async findAllWithProducts(@Req() req) {
    const companyId = req.user.companyId;
    return this.sectorService.findAllWithProducts(companyId);
  }

  @Get(':id')
  @HasPermission('view', 'company_settings:sectors')
  @TenantResource('companySector')
  @ApiOperation({ summary: 'Obtém um setor pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do setor' })
  @ApiResponse({
    status: 200,
    description: 'Setor retornado com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Setor não encontrado.',
  })
  async findOne(@Req() req, @Param('id') id: string) {
    return this.withValues(req, await this.sectorService.findOne(id));
  }

  @Patch(':id')
  @HasPermission('edit', 'company_settings:sectors')
  @TenantResource('companySector')
  @UseGuards(FeatureGuard)
  @RequiresFeature('sectors_configuration')
  @ApiOperation({ summary: 'Atualiza um setor pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do setor' })
  @ApiResponse({
    status: 200,
    description: 'Setor atualizado com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Setor não encontrado.',
  })
  async update(
    @Req() req,
    @Param('id') id: string,
    @Body() updateSectorDto: UpdateSectorDto,
  ) {
    // Marcar um setor como etapa de produção é o recurso "Etapas de produção".
    if (updateSectorDto.isProductionStage === true) {
      const sector = await this.prisma.companySector.findUnique({
        where: { id },
        select: { isProductionStage: true },
      });
      if (sector && !sector.isProductionStage) {
        await this.planControl.enforceFeature(
          req.user.companyId,
          'product_production_stages',
        );
      }
    }
    // Gravar custo ou venda da hora pede a permissão de ver valores
    if (
      (updateSectorDto.hourCost !== undefined ||
        updateSectorDto.hourSale !== undefined) &&
      !(await canViewValues(req, this.abacService))
    ) {
      throw permissionDenied([VALUES_PERMISSION]);
    }
    return this.withValues(
      req,
      await this.sectorService.update(id, updateSectorDto),
    );
  }

  @Delete(':id')
  @HasPermission('delete', 'company_settings:sectors')
  // Sem uso no front e destrutiva: já recusa, sem passar pelo modo observar
  @ObservePermissions(false)
  @TenantResource('companySector')
  @UseGuards(FeatureGuard)
  @RequiresFeature('sectors_configuration')
  @ApiOperation({ summary: 'Remove um setor pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do setor' })
  @ApiResponse({
    status: 200,
    description: 'Setor removido com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Setor não encontrado.',
  })
  remove(@Param('id') id: string) {
    return this.sectorService.remove(id);
  }
}
