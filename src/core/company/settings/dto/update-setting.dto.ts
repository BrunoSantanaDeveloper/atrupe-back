import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsEnum, IsOptional } from 'class-validator';

export class UpdateReasonDto {
  @ApiProperty({ description: 'Texto do motivo', required: false })
  @IsString()
  @IsOptional()
  reason?: string;

  @ApiProperty({
    description: 'Tipo de motivo (REJECTION ou CANCELLATION)',
    enum: ['REJECTION', 'CANCELLATION'],
    required: false,
  })
  @IsEnum(['REJECTION', 'CANCELLATION'])
  @IsOptional()
  type?: 'REJECTION' | 'CANCELLATION';
}
