import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CustomAddressDto {
  @ApiProperty({ description: 'CEP', required: false })
  @IsOptional()
  @IsString()
  zipcode?: string;

  @ApiProperty({ description: 'Estado', required: false })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiProperty({ description: 'Cidade', required: false })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiProperty({ description: 'Bairro', required: false })
  @IsOptional()
  @IsString()
  neighborhood?: string;

  @ApiProperty({ description: 'Rua', required: false })
  @IsOptional()
  @IsString()
  street?: string;

  @ApiProperty({ description: 'Número', required: false })
  @IsOptional()
  @IsString()
  number?: string;

  @ApiProperty({ description: 'Complemento', required: false })
  @IsOptional()
  @IsString()
  complement?: string;
}
