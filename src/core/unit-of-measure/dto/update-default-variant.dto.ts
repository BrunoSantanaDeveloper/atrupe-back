import { IsNotEmpty, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateDefaultVariantDto {
  @IsNotEmpty()
  @IsEnum(['MT', 'CM', 'MM', 'KG', 'GR', 'MG', 'LT', 'ML'])
  @ApiProperty({
    description: 'Nova variante padrão para a unidade de medida',
    enum: ['MT', 'CM', 'MM', 'KG', 'GR', 'MG', 'LT', 'ML'],
    example: 'MM',
  })
  defaultVariant: string;
}
