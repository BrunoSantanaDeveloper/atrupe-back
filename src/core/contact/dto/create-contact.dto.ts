import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateContactDto {
  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Nome do contato',
    example: 'John Doe',
  })
  name: string;

  @IsNotEmpty()
  @ApiProperty({
    description: 'Email do contato',
    example: 'john.doe@example.com',
  })
  email: string;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Telefone do contato',
    example: '+55 11 91234-5678',
  })
  phone: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Telefone celular do contato',
    example: '+55 11 98765-4321',
    required: false,
  })
  mobile: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Observações sobre o contato',
    example: 'Cliente preferencial',
    required: false,
  })
  observations: string;

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID do cliente associado ao contato',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  clientId: string;

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID do fornecedor associado ao contato',
    example: '123e4567-e89b-12d3-a456-426614174001',
    required: false,
  })
  supplierId: string;
}
