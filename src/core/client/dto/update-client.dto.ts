import { PartialType } from '@nestjs/mapped-types';
import { CreateClientDto } from './create-client.dto';
import { IsEnum, IsOptional, IsString, IsUrl, IsUUID } from 'class-validator';
import { ClientStatus } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateClientDto extends PartialType(CreateClientDto) {
  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Apelido do cliente',
    example: 'Johnny',
    required: false,
  })
  nickname: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Inscrição Estadual do cliente',
    example: '123456789',
    required: false,
  })
  ie: string;

  @IsOptional()
  @IsUrl()
  @ApiProperty({
    description: 'Website do cliente',
    example: 'https://example.com',
    required: false,
  })
  site: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Perfil do Facebook do cliente',
    example: 'https://facebook.com/johndoe',
    required: false,
  })
  facebook: string;

  @IsOptional()
  @IsEnum(ClientStatus)
  @ApiProperty({
    description: 'Status do cliente',
    example: ClientStatus.ACTIVE,
    required: false,
    enum: ClientStatus,
  })
  status: ClientStatus;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Data de nascimento do cliente',
    example: '1990-01-01',
    required: false,
  })
  birthdate: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Notas adicionais sobre o cliente',
    example: 'Cliente preferencial',
    required: false,
  })
  notes: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Notas financeiras sobre o cliente',
    example: 'Pagamentos em dia',
    required: false,
  })
  financialNotes: string;

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID do responsável pelo cliente',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  responsibleId: string;

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID da atividade do cliente',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  activityId: string;
}
