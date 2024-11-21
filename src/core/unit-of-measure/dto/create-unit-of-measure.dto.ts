import { IsNotEmpty, IsString, IsUUID } from 'class-validator';
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

  @IsNotEmpty()
  @IsUUID()
  @ApiProperty({
    description: 'ID da empresa associada à unidade de medida',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  companyId: string;
}
