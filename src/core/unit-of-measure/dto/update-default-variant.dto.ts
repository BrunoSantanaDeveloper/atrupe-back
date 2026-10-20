import { IsNotEmpty, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateDefaultVariantDto {
  @IsNotEmpty()
  @IsEnum([
    'MT',
    'CM',
    'MM',
    'KG',
    'GR',
    'MG',
    'LT',
    'ML',
    'KM',
    'HH',
    'UN',
    'M2',
    // A folha (Papéis no LITE, 13/10/2026): o código é o do formato do papel
    'A4',
    'A3',
    'SRA3',
    'A3_PLUS',
    'CUSTOM',
  ])
  @ApiProperty({
    description: 'Nova variante padrão para a unidade de medida',
    enum: [
      'MT',
      'CM',
      'MM',
      'KG',
      'GR',
      'MG',
      'LT',
      'ML',
      'KM',
      'HH',
      'UN',
      'M2',
      'A4',
      'A3',
      'SRA3',
      'A3_PLUS',
      'CUSTOM',
    ],
    example: 'MM',
  })
  defaultVariant: string;
}
