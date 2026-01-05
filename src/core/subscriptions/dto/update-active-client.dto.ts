import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { SubscriptionStatus } from '@prisma/client';

export class UpdateActiveClientDto {
  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Razão social da empresa',
    required: false,
    example: 'Atrupe Sistemas Administrativos LTDA',
  })
  companyName?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'CNPJ da empresa',
    required: false,
    example: '00.000.000/0030-00',
  })
  document?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'ID do estado',
    required: false,
    example: 'SC',
  })
  stateId?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'ID da cidade',
    required: false,
    example: 'ITAJAÍ',
  })
  cityId?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Nome do responsável',
    required: false,
    example: 'Maicol Souza',
  })
  userName?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'CPF do responsável',
    required: false,
    example: '000.000.000-00',
  })
  userDocument?: string;

  @IsOptional()
  @IsEmail()
  @ApiProperty({
    description: 'Email do responsável',
    required: false,
    example: 'maicol@atrupe.com.br',
  })
  email?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Telefone do responsável',
    required: false,
    example: '(47) 98406-4148',
  })
  phone?: string;

  @IsOptional()
  @IsEnum(SubscriptionStatus)
  @ApiProperty({
    description: 'Status da assinatura',
    required: false,
    enum: SubscriptionStatus,
    example: 'ACTIVE',
  })
  status?: SubscriptionStatus;

  @IsString()
  @MinLength(6)
  @ApiProperty({
    description: 'Senha gerencial para autorizar a alteração',
    required: true,
    example: 'senha123',
  })
  password: string;
}
