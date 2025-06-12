import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsBoolean,
  IsOptional,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AcademyFileDto {
  @ApiProperty({
    description: 'Título do arquivo',
    example: 'Manual de Configuração',
  })
  @IsString()
  title: string;

  @ApiProperty({ description: 'Tipo do arquivo', example: 'pdf' })
  @IsString()
  type: string;

  @ApiProperty({
    description: 'URL do arquivo',
    example: 'https://docs.atrupe.com.br/start/manual.pdf',
  })
  @IsString()
  src: string;
}

export class AcademyItemDto {
  @ApiProperty({
    description: 'Identificador único do item',
    example: 'empresa-config',
  })
  @IsString()
  id: string;

  @ApiProperty({
    description: 'Texto descritivo do item',
    example: 'Configure sua empresa',
  })
  @IsString()
  description: string;

  @ApiProperty({
    description: 'Status de conclusão do usuário',
    example: false,
  })
  @IsBoolean()
  checked: boolean;

  @ApiProperty({
    description: 'Lista de arquivos',
    type: [AcademyFileDto],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AcademyFileDto)
  files?: AcademyFileDto[];

  @ApiProperty({
    description: 'ID do vídeo',
    example: '495579294',
    required: false,
  })
  @IsOptional()
  @IsString()
  video?: string;

  @ApiProperty({
    description: 'Página para navegação',
    example: '/configuracoes/empresa',
    required: false,
  })
  @IsOptional()
  @IsString()
  page?: string;

  @ApiProperty({
    description: 'Nome do modal',
    example: 'CompanyInfo',
    required: false,
  })
  @IsOptional()
  @IsString()
  modal?: string;

  @ApiProperty({
    description: 'Título do botão',
    example: 'Cadastrar dados',
    required: false,
  })
  @IsOptional()
  @IsString()
  buttonTitle?: string;
}

export class AcademySectionDto {
  @ApiProperty({
    description: 'Identificador único da seção',
    example: 'configuracoes',
  })
  @IsString()
  id: string;

  @ApiProperty({ description: 'Título da seção', example: 'Configurações' })
  @IsString()
  title: string;

  @ApiProperty({
    description: 'Lista de itens da seção',
    type: [AcademyItemDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AcademyItemDto)
  items: AcademyItemDto[];
}

export class AcademyResponseDto {
  @ApiProperty({ description: 'Tipo do plano', example: 'start' })
  @IsString()
  plan: string;

  @ApiProperty({
    description: 'Lista de seções da academy',
    type: [AcademySectionDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AcademySectionDto)
  sections: AcademySectionDto[];
}
