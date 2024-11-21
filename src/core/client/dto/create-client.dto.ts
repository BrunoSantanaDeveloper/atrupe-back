import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
  IsEmail,
  IsUUID,
  IsDateString,
} from 'class-validator';
import { ClientKind } from '@prisma/client';
import { IsCpf } from '../../../helpers/validators/cpf';
import { IsCnpj } from '../../../helpers/validators/cnpj';
import { ApiProperty } from '@nestjs/swagger';

export class CreateClientDto {
  @IsNotEmpty()
  @IsEnum(ClientKind)
  @ApiProperty({
    description: 'Tipo de cliente (PERSON ou COMPANY)',
    example: 'PERSON',
    enum: ClientKind,
  })
  kind: ClientKind;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Nome do cliente',
    example: 'John Doe',
  })
  name: string;

  @IsOptional()
  @IsEmail()
  @ApiProperty({
    description: 'Email do cliente',
    example: 'johndoe@example.com',
    required: false,
  })
  email?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Telefone do cliente',
    example: '+55 11 91234-5678',
    required: false,
  })
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Celular do cliente',
    example: '+55 11 98765-4321',
    required: false,
  })
  mobilePhone?: string;

  @IsNotEmpty()
  @IsUUID()
  @ApiProperty({
    description: 'ID da categoria do cliente',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  categoryId: string;

  @IsNotEmpty()
  @IsUUID()
  @ApiProperty({
    description: 'ID da empresa associada ao cliente',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  companyId: string;

  @ValidateIf((o) => o.kind === ClientKind.PERSON)
  @IsCpf()
  @IsNotEmpty()
  @ApiProperty({
    description: 'CPF do cliente, válido apenas para clientes do tipo PERSON',
    example: '123.456.789-09',
    required: false,
  })
  cpf?: string;

  @ValidateIf((o) => o.kind === ClientKind.PERSON)
  @IsString()
  @IsNotEmpty()
  @ApiProperty({
    description: 'RG do cliente, válido apenas para clientes do tipo PERSON',
    example: '12.345.678-9',
    required: false,
  })
  rg?: string;

  @ValidateIf((o) => o.kind === ClientKind.COMPANY)
  @IsCnpj()
  @IsNotEmpty()
  @ApiProperty({
    description: 'CNPJ do cliente, válido apenas para clientes do tipo COMPANY',
    example: '12.345.678/0001-99',
    required: false,
  })
  cnpj?: string;

  @ValidateIf((o) => o.kind === ClientKind.COMPANY)
  @IsString()
  @IsOptional()
  @ApiProperty({
    description:
      'Inscrição estadual do cliente, válido apenas para clientes do tipo COMPANY',
    example: '123456789',
    required: false,
  })
  stateRegistration?: string;

  @ValidateIf((o) => o.kind === ClientKind.PERSON)
  @IsDateString()
  @IsNotEmpty()
  @ApiProperty({
    description:
      'Data de nascimento do cliente, válido apenas para clientes do tipo PERSON',
    example: '1990-01-01',
    required: false,
  })
  birthdate?: string;

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID da cidade do cliente',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  cityId: string;

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID do estado do cliente',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  stateId: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'CEP do cliente',
    example: '12345-678',
    required: false,
  })
  zipcode: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Rua do cliente',
    example: 'Rua Exemplo',
    required: false,
  })
  street: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Número do endereço do cliente',
    example: '123',
    required: false,
  })
  number: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Bairro do cliente',
    example: 'Bairro Exemplo',
    required: false,
  })
  neighborhood: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Complemento do endereço do cliente',
    example: 'Apto 101',
    required: false,
  })
  complement: string;
}
