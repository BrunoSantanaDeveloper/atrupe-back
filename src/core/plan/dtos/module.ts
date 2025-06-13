import { ApiProperty } from '@nestjsx/crud/lib/crud';
import { IsString, IsNumber, IsOptional, IsUUID } from 'class-validator';

export class CreateModuleDTO {
  @IsString()
  @ApiProperty({
    description: 'Nome do módulo',
    example: 'Módulo de Relatórios',
    required: true,
  })
  name: string;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'Descrição do módulo',
    example: 'Módulo para geração de relatórios avançados',
    required: false,
  })
  description?: string;

  @IsNumber()
  @ApiProperty({
    description: 'Preço do módulo',
    example: 99.9,
    required: true,
  })
  price: number;
}

export class UpdateModuleDTO extends CreateModuleDTO {}

export class ListModuleDTO extends CreateModuleDTO {
  @IsUUID()
  @ApiProperty({
    description: 'ID do módulo',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: true,
  })
  id: string;
}
