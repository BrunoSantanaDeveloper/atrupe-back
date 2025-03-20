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
import { NatureFilterDto } from './dto/nature-filter.dto';

const RESOURCE = 'nature';
const GROUP = 'financial';

@ApiTags('Plano de contas')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller(`${GROUP}/${RESOURCE}`)
export class NatureController {
  constructor(private readonly natureService: NatureService) {}

  @Post()
  create(@Req() req, @Body() createNatureDto: CreateNatureDto) {
    createNatureDto.companyId = req.user.companyId;
    return this.natureService.create(createNatureDto);
  }
  @Post('sub-category/:id')
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
  findAllSubCategory(@Param('natureId') natureId: string) {
    return this.natureService.findAllSubCategoryByNature(natureId);
  }
  // @Get('sub-category/:id')
  // findOneSubCategory(@Param('id') id: string) {
  //   return this.natureService.findOneSubCategory(id);
  // }

  @Get('quantity')
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
  async findAll(@Query() filterDto: NatureFilterDto, @Req() req) {
    filterDto.companyId = req.user.companyId;
    return await this.natureService.findAll(filterDto);
  }
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.natureService.findOne(id);
  }
  @Patch('sub-category/:id')
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
  removeSubCategory(@Param('id') id: string) {
    return this.natureService.removeSubCategory(id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateNatureDto: UpdateNatureDto,
  ) {
    return await this.natureService.update(id, updateNatureDto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return await this.natureService.remove(id);
  }
}
