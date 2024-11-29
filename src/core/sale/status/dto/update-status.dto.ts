import { ApiProperty } from '@nestjs/swagger';
import { IsHexColor, IsOptional, IsString } from 'class-validator';

export class UpdateStatusQuotationDto {
  @ApiProperty({
    description: 'Título do status de orçamento',
    example: 'Cliente não encontado',
  })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiProperty({
    description:
      'Cor associada ao status de orçamento (em formato hexadecimal)',
    example: '#FF0000',
  })
  @IsHexColor()
  @IsOptional()
  color?: string;
}
