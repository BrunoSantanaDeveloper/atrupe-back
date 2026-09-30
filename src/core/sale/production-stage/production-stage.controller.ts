import {
  Controller,
  Get,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ProductionStageService } from './production-stage.service';
import { UpdateProductionStageDto } from './dto/update-production-stage.dto';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { FeatureGuard } from 'src/core/plan/guards/feature.guard';
import { RequiresFeature } from 'src/core/plan/decorators/requires-feature.decorator';

const RESOURCE = 'production-stage';

@ApiTags('Estágios de produção - Agenda de entrega')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller(`sale/${RESOURCE}`)
export class ProductionStageController {
  constructor(
    private readonly productionStageService: ProductionStageService,
  ) {}

  // @Post()
  // @ApiOperation({ summary: 'Criar um estágio de produção' })
  // @ApiResponse({ status: 201, description: 'Estágio criado com sucesso.' })
  // create(@Body() createProductionStageDto: CreateProductionStageDto) {
  //   return this.productionStageService.create(createProductionStageDto);
  // }

  @Get()
  @ApiOperation({ summary: 'Listar todos os estágios de produção' })
  findAll() {
    return this.productionStageService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar um estágio de produção pelo ID' })
  findOne(@Param('id') id: string) {
    return this.productionStageService.findOne(id);
  }

  @Patch(':id')
  // Mudar o status das etapas na agenda é recurso de plano.
  @UseGuards(FeatureGuard)
  @RequiresFeature('delivery_stage_status_change')
  @ApiOperation({ summary: 'Atualizar um estágio de produção' })
  update(
    @Param('id') id: string,
    @Body() updateProductionStageDto: UpdateProductionStageDto,
  ) {
    return this.productionStageService.update(id, updateProductionStageDto);
  }

  @Get('schedule/:id')
  // Mudar o status das etapas na agenda é recurso de plano.
  @UseGuards(FeatureGuard)
  @RequiresFeature('delivery_stage_status_change')
  @ApiOperation({ summary: 'Atualizar um estágio de produção' })
  async updateSchedule(@Param('id') id: string) {
    return await this.productionStageService.updateStatusIfAllStagesAreDone(id);
  }

  @Delete(':id')
  // Mudar o status das etapas na agenda é recurso de plano.
  @UseGuards(FeatureGuard)
  @RequiresFeature('delivery_stage_status_change')
  @ApiOperation({ summary: 'Excluir um estágio de produção' })
  remove(@Param('id') id: string) {
    return this.productionStageService.remove(id);
  }
}
