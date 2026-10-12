import { IsEnum, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { MaterialPriceRule } from '@prisma/client';

/** A regra e o preço do material, ou da variação quando houver (DC-6, PR-2). */
export class UpdateMaterialPriceDto {
  @IsOptional()
  @IsUUID()
  @ApiProperty({
    required: false,
    description:
      'Obrigatório quando o material tem variação e proibido quando não tem',
  })
  variationId?: string;

  @IsEnum(MaterialPriceRule)
  @ApiProperty({ enum: MaterialPriceRule })
  rule: MaterialPriceRule;

  @IsInt({ message: 'O preço vai em centavos, sem casas decimais.' })
  @Min(1, { message: 'Informe um preço maior que zero.' })
  @ApiProperty({ example: 2800 })
  price: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @ApiProperty({
    required: false,
    description:
      'Lucro informado no preço variável, em décimos de ponto (300 = 30,0 %)',
    example: 300,
  })
  desiredMargin?: number;
}
