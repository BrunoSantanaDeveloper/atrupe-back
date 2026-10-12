import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
  Req,
} from '@nestjs/common';
import { AssetService } from './asset.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { PermissionsGuard } from '../auth/abac/permissions.guard';
import { MoneyFields } from '../auth/abac/money-fields.decorator';
import { ASSET_MONEY_FIELDS } from '../auth/abac/money-fields';
import { FeatureGuard } from '../plan/guards/feature.guard';
import { RequiresFeature } from '../plan/decorators/requires-feature.decorator';

const RESOURCE = 'asset';
// Patrimônios são da base de custos (plano PRO). A empresa é sempre a da
// sessão: o id de outra empresa responde 404. A reescrita completa
// (permissões, filtros) é do módulo 4.
@UseGuards(JwtAuthGuard, PermissionsGuard, FeatureGuard)
@RequiresFeature('cost_base')
@Controller(RESOURCE)
export class AssetController {
  constructor(private readonly assetService: AssetService) {}

  @Post()
  // @HasPermission(AbacAction.Create, RESOURCE)
  create(@Req() req, @Body() createAssetDto: CreateAssetDto) {
    return this.assetService.create(req.user.companyId, createAssetDto);
  }

  @Get()
  @MoneyFields(...ASSET_MONEY_FIELDS)
  // @HasPermission(AbacAction.List, RESOURCE)
  findAll(
    @Req() req,
    @Query('pageSize') pageSize: number = 10,
    @Query('page') page: number = 1,
  ) {
    return this.assetService.findAll(req.user.companyId, pageSize, page);
  }

  // Antes de `:id`, para não ser lido como um id.
  @Get('/types')
  // @HasPermission(AbacAction.List, RESOURCE)
  allTypes(@Req() req) {
    return this.assetService.findAllTypes(req.user.companyId);
  }

  @Get(':id')
  @MoneyFields(...ASSET_MONEY_FIELDS)
  // @HasPermission(AbacAction.Get, RESOURCE)
  findOne(@Req() req, @Param('id') id: string) {
    return this.assetService.findOne(req.user.companyId, id);
  }

  @Patch(':id')
  // @HasPermission(AbacAction.Update, RESOURCE)
  update(
    @Req() req,
    @Param('id') id: string,
    @Body() updateAssetDto: UpdateAssetDto,
  ) {
    return this.assetService.update(req.user.companyId, id, updateAssetDto);
  }

  @Delete(':id')
  // @HasPermission(AbacAction.Delete, RESOURCE)
  remove(@Req() req, @Param('id') id: string) {
    return this.assetService.remove(req.user.companyId, id);
  }
}
