import { ApiPropertyOptional } from '@nestjs/swagger';
import { ReasonType } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';

export class CancelReasonFilterDto extends BaseFilterDTO {
  @ApiPropertyOptional({
    description: 'Tipo do motivo (por exemplo, CANCELLATION, REJECTION).',
    example: 'CANCELLATION',
  })
  @IsEnum(ReasonType)
  @IsOptional()
  type?: ReasonType;

  @ApiPropertyOptional({
    description: 'Texto de busca pelo motivo.',
    example: 'Insuficiencia',
  })
  @IsOptional()
  search?: string;
}
