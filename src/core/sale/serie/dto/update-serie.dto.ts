import { PartialType } from '@nestjs/mapped-types';
import { CreateSaleSeriesDto } from './create-series.dto';

export class UpdateSaleSeriesDto extends PartialType(CreateSaleSeriesDto) {}
