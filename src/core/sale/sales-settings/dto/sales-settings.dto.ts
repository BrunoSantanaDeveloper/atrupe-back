import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Max, Min } from 'class-validator';

const MARKUP_RANGE = 'O acréscimo precisa ser um percentual entre 0 % e 1000 %';

export class UpdateSalesSettingsDto {
  // Percentual com até duas casas: 45 = 45 %. Acréscimo sobre o custo
  // (custo × (1 + %)); o nome do campo é da primeira versão
  @IsNumber({ maxDecimalPlaces: 2 }, { message: MARKUP_RANGE })
  @Min(0, { message: MARKUP_RANGE })
  @Max(1000, { message: MARKUP_RANGE })
  @ApiProperty({ example: 45 })
  outsourcedMarkup: number;
}
