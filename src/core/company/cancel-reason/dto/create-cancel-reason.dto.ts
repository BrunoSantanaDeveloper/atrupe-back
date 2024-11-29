import { ApiProperty } from '@nestjs/swagger';
import { ReasonType } from '@prisma/client';
import { IsString, IsEnum, IsNotEmpty } from 'class-validator';

export class CreateReasonDto {
  @ApiProperty({ description: 'Texto do motivo' })
  @IsString()
  @IsNotEmpty()
  reason: string;

  @ApiProperty({
    description: 'Tipo de motivo (REJECTION ou CANCELLATION)',
    example: 'REJECTION || CANCELLATION',
    enum: ReasonType,
  })
  @IsEnum(ReasonType)
  type: ReasonType;

  companyId: string;
}
