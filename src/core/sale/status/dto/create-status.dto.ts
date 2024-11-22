import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsHexColor } from 'class-validator';

export class CreateStatusQuotationDto {
  @ApiProperty({
    description: 'Título do status de orçamento',
    example: 'Cliente não encontado',
  })
  @IsString()
  title: string;

  @ApiProperty({
    description:
      'Cor associada ao status de orçamento (em formato hexadecimal)',
    example: '#FF0000',
  })
  @IsHexColor()
  color: string;
  companyId: string;
}
