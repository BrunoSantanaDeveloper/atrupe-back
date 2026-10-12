import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Max, Min } from 'class-validator';

const MARKUP_RANGE = 'O markup precisa ser um percentual entre 0 % e 99 %';

export class UpdateSalesSettingsDto {
  // Percentual com até duas casas: 45 = 45 %. 100 % daria divisão por zero
  // no preço sugerido (custo ÷ (1 − markup/100))
  @IsNumber({ maxDecimalPlaces: 2 }, { message: MARKUP_RANGE })
  @Min(0, { message: MARKUP_RANGE })
  @Max(99.99, { message: MARKUP_RANGE })
  @ApiProperty({ example: 45 })
  outsourcedMarkup: number;
}
