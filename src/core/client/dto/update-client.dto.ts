import { PartialType } from '@nestjs/mapped-types';
import { CreateClientDto } from './create-client.dto';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID } from 'class-validator';
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

  // "Sem responsável" chega como null ou "": os dois limpam o campo
  @Transform(({ value }) => (value === '' ? null : value))
  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID do responsável pelo cliente; null limpa',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
    nullable: true,
  })
  responsibleId?: string | null;

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID da atividade do cliente',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  activityId: string;
}
