import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class NewProductionSectorDto {
  @IsString()
  @MinLength(2, { message: 'O nome do setor precisa de 2 letras ou mais' })
  @MaxLength(60)
  @ApiProperty({ example: 'Serralheria' })
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  @ApiPropertyOptional({ example: 'tool' })
  icon?: string;
}

/** "Seus setores de produção" (área 9 §4.16): os que ficam ativos e os novos. */
export class ProductionSetupDto {
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  @ApiProperty({ type: [String] })
  activeIds: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => NewProductionSectorDto)
  @ApiPropertyOptional({ type: [NewProductionSectorDto] })
  newSectors?: NewProductionSectorDto[];
}
