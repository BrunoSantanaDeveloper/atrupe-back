import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateRoleDto {
  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Nome da função',
    example: 'Admin',
    required: true,
  })
  name: string;

  companyId: string;
  @IsOptional()
  @ApiProperty({
    description: 'ID do setor associado à função',
    example: '456e7890-e12d-34a6-b789-567890123456',
    required: true,
  })
  sectorId?: string;
}

export class CreatePolicyDto {
  @ApiProperty({
    description: 'Nome do Resource',
    example: 'Cadastro de Clientes',
  })
  @IsNotEmpty()
  @IsString()
  resource: string;

  @ApiProperty({
    description: 'Lista de Ações permitidas para o Resource',
    example: ['view', 'edit', 'create', 'delete'],
  })
  @IsArray()
  @IsNotEmpty()
  actions: string[];
}
