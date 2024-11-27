import { PartialType } from '@nestjs/swagger';
import { CreateProductionStageDto } from './create-production-stage.dto';

export class UpdateProductionStageDto extends PartialType(
  CreateProductionStageDto,
) {}
