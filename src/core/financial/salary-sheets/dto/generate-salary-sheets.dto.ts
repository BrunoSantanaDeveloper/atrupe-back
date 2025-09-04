import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsNumber,
  IsString,
  Min,
  Max,
  ArrayMinSize,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class GenerateSalarySheetsDto {
  @ApiProperty({
    description: 'Mês de referência (0-11)',
    example: 2,
  })
  @IsNumber()
  @Min(0)
  @Max(11)
  @Transform(({ value }) => parseInt(value))
  month: number;

  @ApiProperty({
    description: 'Ano de referência',
    example: 2024,
  })
  @IsNumber()
  @Min(2000)
  @Max(2100)
  @Transform(({ value }) => parseInt(value))
  year: number;

  @ApiProperty({
    description: 'Lista de IDs dos colaboradores',
    example: ['id1', 'id2'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  list: string[];
}
