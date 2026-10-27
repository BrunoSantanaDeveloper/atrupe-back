import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

const MARKUP_RANGE = 'O acréscimo precisa ser um percentual entre 0 % e 1000 %';
const MIN_VALUE_RANGE =
  'A venda mínima precisa ser um valor em centavos, zero ou mais';

export class UpdateSalesSettingsDto {
  // Percentual com até duas casas: 45 = 45 %. Acréscimo sobre o custo
  // (custo × (1 + %)); o nome do campo é da primeira versão. Opcional desde
  // 27/10/2026: cada tela manda só o que muda
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: MARKUP_RANGE })
  @Min(0, { message: MARKUP_RANGE })
  @Max(1000, { message: MARKUP_RANGE })
  @ApiPropertyOptional({ example: 45 })
  outsourcedMarkup?: number;

  // Venda mínima por item, em centavos (27/10/2026); 0 = sem mínimo
  @IsOptional()
  @IsInt({ message: MIN_VALUE_RANGE })
  @Min(0, { message: MIN_VALUE_RANGE })
  @ApiPropertyOptional({ example: 1500 })
  minItemValue?: number;
}
