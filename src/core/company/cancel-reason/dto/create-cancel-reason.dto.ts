import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsEnum, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateReasonDto {
  @ApiProperty({ description: 'Texto do motivo' })
  @IsString()
  @IsNotEmpty()
  reason: string;

  @ApiProperty({
    description: 'Tipo de motivo (REJECTION ou CANCELLATION)',
    example: 'REJECTION || CANCELLATION',
    enum: ['REJECTION', 'CANCELLATION'],
  })
  @IsEnum(['REJECTION', 'CANCELLATION'])
  type: 'REJECTION' | 'CANCELLATION';

  @ApiProperty({ description: 'ID da empresa relacionada' })
  @IsOptional()
  companyId: string;
}
