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
} from '@nestjs/common';
import { AssetService } from './asset.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { PermissionsGuard } from '../auth/abac/permissions.guard';

const RESOURCE = 'asset';
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller(RESOURCE)
export class AssetController {
  constructor(private readonly assetService: AssetService) {}

  @Post()
  // @HasPermission(AbacAction.Create, RESOURCE)
  create(@Body() createAssetDto: CreateAssetDto) {
    return this.assetService.create(createAssetDto);
  }

  @Get()
  // @HasPermission(AbacAction.List, RESOURCE)
  findAll(
    @Query('pageSize') pageSize: number = 10,
    @Query('page') page: number = 1,
  ) {
    return this.assetService.findAll(pageSize, page);
  }

  @Get('/types')
  // @HasPermission(AbacAction.List, RESOURCE)
  allTypes() {
    return this.assetService.findAllTypes();
  }

  @Get(':id')
  // @HasPermission(AbacAction.Get, RESOURCE)
  findOne(@Param('id') id: string) {
    return this.assetService.findOne(id);
  }

  @Patch(':id')
  // @HasPermission(AbacAction.Update, RESOURCE)
  update(@Param('id') id: string, @Body() updateAssetDto: UpdateAssetDto) {
    return this.assetService.update(id, updateAssetDto);
  }

  @Delete(':id')
  // @HasPermission(AbacAction.Delete, RESOURCE)
  remove(@Param('id') id: string) {
    return this.assetService.remove(id);
  }
}
