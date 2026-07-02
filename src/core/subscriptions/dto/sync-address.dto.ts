import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, MinLength } from 'class-validator';

export class SyncAddressDto {
  @ApiPropertyOptional({ example: '89201-000' })
  @IsOptional()
  @IsString()
  postalCode?: string;

  @ApiPropertyOptional({ example: 'Rua das Flores' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: '123' })
  @IsOptional()
  @IsString()
  addressNumber?: string;

  @ApiPropertyOptional({ example: 'Sala 2' })
  @IsOptional()
  @IsString()
  complement?: string;

  @ApiPropertyOptional({ example: 'Centro' })
  @IsOptional()
  @IsString()
  province?: string;

  @ApiPropertyOptional({ example: 'Joinville' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 'SC' })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiProperty({ description: 'Senha gerencial para autorizar a alteração' })
  @IsString()
  @MinLength(6)
  password: string;
}
