import { IsNotEmpty, IsString } from 'class-validator';
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
    example: 'kg',
  })
  code: string;

  companyId: string;
}
