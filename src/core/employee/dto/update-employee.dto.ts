import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class AddressDto {
  @ApiProperty({
    description: 'Tipo do endereço (Residencial, Comercial, etc)',
    example: 'Residencial',
  })
  @IsString()
  type: string;

  @ApiProperty({
    description: 'CEP',
    example: '12345-678',
  })
  @IsString()
  zipcode: string;

  @ApiProperty({
    description: 'Estado',
    example: 'SP',
  })
  @IsString()
  state: string;

  @ApiProperty({
    description: 'Cidade',
    example: 'São Paulo',
  })
  @IsString()
  city: string;

  @ApiProperty({
    description: 'Bairro',
    example: 'Centro',
  })
  @IsString()
  neighborhood: string;

  @ApiProperty({
    description: 'Rua/Avenida',
    example: 'Avenida Paulista',
  })
  @IsString()
  street: string;

  @ApiProperty({
    description: 'Número',
    example: '1000',
  })
  @IsString()
  number: string;

  @ApiPropertyOptional({
    description: 'Complemento',
    example: 'Apto 123',
  })
  @IsOptional()
  @IsString()
  complement?: string;
}

export class UpdateEmployeeDto {
  @ApiPropertyOptional({
    description: 'Status do funcionário (ativo/inativo)',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsOptional()
  @ApiProperty({
    description: 'ID do setor associado ao colaborador',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  sectorId?: string;

  @IsOptional()
  @ApiProperty({
    description: 'ID do cargo associado ao colaborador',
    example: '123e4567-e89b-12d3-a456-426614174002',
  })
  roleId?: string;

  @ApiPropertyOptional({
    description: 'Nome completo do funcionário',
    example: 'João Silva',
  })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({
    description: 'CPF do funcionário',
    example: '123.456.789-00',
  })
  @IsString()
  @IsOptional()
  cpf?: string;

  @ApiPropertyOptional({
    description: 'RG do funcionário',
    example: '12.345.678-9',
  })
  @IsString()
  @IsOptional()
  rg?: string;

  @ApiPropertyOptional({
    description: 'Telefone fixo do funcionário',
    example: '(11) 3333-4444',
  })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({
    description: 'Telefone celular do funcionário',
    example: '(11) 98888-7777',
  })
  @IsString()
  @IsOptional()
  mobile?: string;

  @ApiPropertyOptional({
    description: 'URL da foto do funcionário',
    example: 'https://exemplo.com/foto.jpg',
  })
  @IsString()
  @IsOptional()
  avatarUrl?: string;

  @ApiPropertyOptional({
    description: 'Salário do funcionário',
    example: 5000,
  })
  @IsNumber()
  @IsOptional()
  sallary?: number;

  @IsOptional()
  @ApiPropertyOptional({
    description: 'Endereço do funcionário',
    type: AddressDto,
  })
  @Type(() => AddressDto)
  address?: AddressDto; // singular
}
