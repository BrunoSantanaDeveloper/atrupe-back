import { ApiProperty } from '@nestjs/swagger';
import {
  IsOptional,
  IsEnum,
  IsIn,
  IsNumberString,
  IsString,
} from 'class-validator';
import { SheetStatus, ItemType } from '@prisma/client';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';

export class GetSalarySheetsDto extends BaseFilterDTO {
  @ApiProperty({
    description: 'Mês da folha (1-12)',
    example: 11,
    required: false,
    type: Number,
  })
  @IsOptional()
  @IsNumberString()
  @IsIn(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'])
  month?: number;

  @ApiProperty({
    description: 'Ano da folha',
    example: 2024,
    required: false,
  })
  @IsOptional()
  @IsNumberString()
  year?: number;

  @ApiProperty({
    description: 'Status da folha (EMPTY, OPEN, CLOSED)',
    enum: SheetStatus,
    example: SheetStatus.OPEN,
    required: false,
  })
  @IsOptional()
  @IsEnum(SheetStatus)
  status?: SheetStatus;

  @ApiProperty({
    description: 'ID da empresa',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: true,
  })
  @IsString()
  companyId: string;

  @ApiProperty({
    description: 'ID do setor para filtrar',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  @IsOptional()
  @IsString()
  sectorId?: string;

  @ApiProperty({
    description: 'Nome do colaborador para filtrar',
    example: 'João Silva',
    required: false,
  })
  @IsOptional()
  @IsString()
  employeeName?: string;

  @ApiProperty({
    description: 'Tipo de item para filtrar (INCREASE, DISCOUNT, ADVANCE)',
    enum: ItemType,
    example: ItemType.INCREASE,
    required: false,
  })
  @IsOptional()
  @IsEnum(ItemType)
  itemType?: ItemType;

  @ApiProperty({
    description:
      'Termo de busca geral (busca em nome do colaborador e descrição dos itens)',
    example: 'bônus',
    required: false,
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({
    description: 'Campo para ordenação (month, year, status, employeeName)',
    example: 'month',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsIn(['month', 'year', 'status', 'employeeName'])
  orderBy?: string;

  @ApiProperty({
    description: 'Direção da ordenação (asc ou desc)',
    example: 'desc',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsIn(['asc', 'desc'])
  orderDirection?: 'asc' | 'desc';
}
