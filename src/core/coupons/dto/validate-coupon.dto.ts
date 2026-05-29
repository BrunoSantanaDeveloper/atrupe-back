import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class ValidateCouponDto {
  @ApiProperty({
    description: 'Código do cupom de desconto',
    example: 'BEMVINDO20',
  })
  @IsString()
  code: string;

  @ApiProperty({
    description: 'ID do plano que está sendo assinado',
    required: false,
  })
  @IsOptional()
  @IsString()
  planId?: string;

  @ApiProperty({
    description: 'Se a validação é para adição de módulo',
    required: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isModuleAddition?: boolean = false;
}
