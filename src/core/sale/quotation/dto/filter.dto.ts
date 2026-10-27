import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  IsIn,
} from 'class-validator';
import { QuotationStatus } from '@prisma/client';
import { BaseFilterDTO } from '../../../../shared/dto/filter.dto';
import { ApiProperty } from '@nestjs/swagger';

export class FilterQuotationDto extends BaseFilterDTO {
  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Texto de busca para filtrar os orçamentos',
    example: 'Produto exemplo',
    required: false,
  })
  search?: string;

  @IsOptional()
  @IsEnum(QuotationStatus)
  @ApiProperty({
    description: 'Status do orçamento para filtrar os resultados',
    example: QuotationStatus.OPEN,
    enum: QuotationStatus,
    required: false,
  })
  status?: QuotationStatus;

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID do vendedor para filtrar os orçamentos',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  sellerId?: string;

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID da série para filtrar os orçamentos',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  serieId?: string;

  @IsOptional()
  @IsDateString()
  @ApiProperty({
    description: 'Data para filtrar os orçamentos',
    example: '2023-05-28',
    required: false,
  })
  date?: string;

  @IsOptional()
  @IsDateString()
  @ApiProperty({
    description: 'Data inicial para filtrar os orçamentos',
    example: '2023-05-01',
    required: false,
  })
  startDate?: string;

  @IsOptional()
  @IsDateString()
  @ApiProperty({
    description: 'Data final para filtrar os orçamentos',
    example: '2023-05-31',
    required: false,
  })
  endDate?: string;

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID do cliente para filtrar os orçamentos',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  clientId?: string;

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description:
      'Marcador de acompanhamento (status de orçamento) para filtrar',
    required: false,
  })
  tagId?: string;

  @IsOptional()
  @IsIn(['due', 'none', 'expiring'])
  @ApiProperty({
    description:
      '"due": em negociação com próximo contato até hoje ou proposta vencendo em até 2 dias ("para retomar"); "none": Aguardando sem próximo contato; "expiring": Aguardando com validade em até 2 dias (CRM-2, 27/10/2026)',
    required: false,
    enum: ['due', 'none', 'expiring'],
  })
  nextContact?: 'due' | 'none' | 'expiring';

  // Ordenação da lista (27/10/2026): pela data de criação (padrão) ou pela
  // data do próximo contato; os grupos da lista seguem a mesma data
  @IsOptional()
  @IsIn(['createdAt', 'nextContactAt'])
  @ApiProperty({
    description:
      'Data que ordena e agrupa a lista: criação (padrão) ou próximo contato',
    required: false,
    enum: ['createdAt', 'nextContactAt'],
  })
  orderBy?: 'createdAt' | 'nextContactAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  @ApiProperty({
    description: 'Sentido da ordenação; padrão desc (mais novo primeiro)',
    required: false,
    enum: ['asc', 'desc'],
  })
  sort?: 'asc' | 'desc';
}
