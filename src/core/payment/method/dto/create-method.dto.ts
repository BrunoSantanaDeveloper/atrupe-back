import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateMethodDto {
  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Nome do método de pagamento',
    example: 'Cartão de Crédito',
  })
  name: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Descrição do método de pagamento',
    example: 'Pagamento via cartão de crédito',
    required: false,
  })
  description: string;

  @IsNotEmpty()
  @IsUUID()
  @ApiProperty({
    description: 'ID da empresa associada ao método de pagamento',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  companyId: string;
}
