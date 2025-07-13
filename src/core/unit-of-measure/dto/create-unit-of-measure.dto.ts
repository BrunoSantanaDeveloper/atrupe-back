import { IsNotEmpty, IsString, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateUnitOfMeasureDto {
  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Nome da unidade de medida',
    example: 'Quilograma',
  })
  name: string;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Código da unidade de medida',
    example: 'KG',
  })
  code: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Descrição da unidade de medida',
    example: 'Unidade de peso em quilogramas',
    required: false,
  })
  description?: string;

  @IsOptional()
  @IsEnum([
    'LENGTH',
    'WEIGHT',
    'CAPACITY',
    'DISTANCE',
    'DURATION',
    'UNITY',
    'AREA',
  ])
  @ApiProperty({
    description: 'Tipo da unidade de medida',
    enum: [
      'LENGTH',
      'WEIGHT',
      'CAPACITY',
      'DISTANCE',
      'DURATION',
      'UNITY',
      'AREA',
    ],
    example: 'WEIGHT',
    required: false,
  })
  kind?: string;

  @IsOptional()
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
  ])
  @ApiProperty({
    description: 'Variante da unidade de medida',
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
    ],
    example: 'KG',
    required: false,
  })
  variant?: string;
}
