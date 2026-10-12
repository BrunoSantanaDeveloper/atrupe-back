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
} from '@nestjs/common';
import { NatureService } from './nature.service';
import { CreateNatureDto, CreateSubCategoryDto } from './dto/create-nature.dto';
import { UpdateNatureDto, UpdateSubCategoryDto } from './dto/update-nature.dto';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { PermissionsGuard } from 'src/core/auth/abac/permissions.guard';
import { HasPermission } from 'src/core/auth/abac/has-permission.decorator';
import { HasAnyPermission } from 'src/core/auth/abac/has-any-permission.decorator';
import { NatureFilterDto } from './dto/nature-filter.dto';

const RESOURCE = 'nature';
const GROUP = 'financial';

/**
 * Configurações > Financeiro > Plano de contas, com as chaves que a tela usa.
 * As listas de apoio (`natures/*` e `sub-category/:natureId`) ficam sem
 * permissão: os formulários de contas a pagar e a receber as usam.
 */
const PERMISSION = 'financial_settings:chart_accounts';

@ApiTags('Plano de contas')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
@Controller(`${GROUP}/${RESOURCE}`)
export class NatureController {
  constructor(private readonly natureService: NatureService) {}

  @Post()
  @HasPermission('create', PERMISSION)
  create(@Req() req, @Body() createNatureDto: CreateNatureDto) {
    createNatureDto.companyId = req.user.companyId;
    return this.natureService.create(createNatureDto);
  }
  @Post('sub-category/:id')
  // Subcategoria é linha de dentro da natureza, que pela regra do time pede
  // edit; a tela mostra "Adicionar subcategoria" para quem tem create.
  @HasAnyPermission(
    { action: 'create', resource: PERMISSION },
    { action: 'edit', resource: PERMISSION },
  )
  async createSubCategory(
    @Req() req,
    @Param('id') id: string,
    @Body() createSubCategoryDto: CreateSubCategoryDto,
  ) {
    createSubCategoryDto.companyId = req.user.companyId;
    createSubCategoryDto.natureId = id;
    return await this.natureService.createSubCategory(createSubCategoryDto);
  }

  @Get('natures/:level1')
  async findAllSubNatures(@Req() req, @Param('level1') level1: string) {
    const companyId = req.user.companyId;
    return await this.natureService.findAllNatures(companyId, level1);
  }
  @Get('natures/:level1/level2/:level2')
  async findAllSubNaturesLevel2(
    @Req() req,
    @Param('level1') level1: string,
    @Param('level2') level2: string,
  ) {
    const companyId = req.user.companyId;
    return await this.natureService.findAllNaturesByLevel2(
      companyId,
      level1,
      level2,
    );
  }

  @Get('sub-category/:natureId')
  findAllSubCategory(@Req() req, @Param('natureId') natureId: string) {
    return this.natureService.findAllSubCategoryByNature(
      natureId,
      req.user.companyId,
    );
  }

  @Get('quantity')
  @HasPermission('view', PERMISSION)
  @ApiOperation({
    summary: 'Obtém a quantidade de todos as categorias em seus status.',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de quantidade de categorias retornada com sucesso.',
  })
  async findAllQuantity(@Req() req) {
    const companyId = req.user.companyId;
    return this.natureService.findAllQuantity(companyId);
  }

  @Get()
  @HasPermission('view', PERMISSION)
  async findAll(@Query() filterDto: NatureFilterDto, @Req() req) {
    filterDto.companyId = req.user.companyId;
    return await this.natureService.findAll(filterDto);
  }
  @Get(':id')
  @HasPermission('view', PERMISSION)
  findOne(@Req() req, @Param('id') id: string) {
    return this.natureService.findOne(id, req.user.companyId);
  }
  @Patch('sub-category/:id')
  @HasPermission('edit', PERMISSION)
  updateSubCategory(
    @Param('id') id: string,
    @Body() updateSubCategoryDto: UpdateSubCategoryDto,
    @Req() req,
  ) {
    const companyId = req.user.companyId;
    return this.natureService.updateSubCategory(
      id,
      updateSubCategoryDto,
      companyId,
    );
  }

  @Delete('sub-category/:id')
  // Linha de dentro da natureza: edit, pela regra do time
  @HasPermission('edit', PERMISSION)
  removeSubCategory(@Req() req, @Param('id') id: string) {
    return this.natureService.removeSubCategory(id, req.user.companyId);
  }

  @Patch(':id')
  @HasPermission('edit', PERMISSION)
  async update(
    @Req() req,
    @Param('id') id: string,
    @Body() updateNatureDto: UpdateNatureDto,
  ) {
    return await this.natureService.update(
      id,
      req.user.companyId,
      updateNatureDto,
    );
  }

  @Delete(':id')
  @HasPermission('delete', PERMISSION)
  async remove(@Req() req, @Param('id') id: string) {
    return await this.natureService.remove(id, req.user.companyId);
  }
}
