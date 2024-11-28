import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsEnum, IsIn, IsNumberString } from 'class-validator';
import { SheetStatus } from '@prisma/client';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';

export class GetSalarySheetsDto extends BaseFilterDTO {
  @ApiProperty({
    description: 'Mês da folha',
    example: 11,
    required: false,
    type: Number,
  })
  @IsOptional()
  @IsNumberString()
  @IsIn(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'])
  month?: number;

  @ApiProperty({ description: 'Ano da folha', example: 2024, required: false })
  @IsOptional()
  @IsNumberString()
  year?: number; // Ano de referência da folha

  @ApiProperty({
    description: 'Status da folha',
    example: 'OPEN',
    required: false,
  })
  @IsOptional()
  @IsEnum(SheetStatus)
  status?: SheetStatus; // Status da folha (OPEN ou CLOSED)
}
