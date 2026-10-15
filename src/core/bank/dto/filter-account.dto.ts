import { BankAccountKind } from '@prisma/client';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class BankAccountFilterDTO extends BaseFilterDTO {
  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID do banco associado',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  bankId: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true')
  @ApiProperty({
    description: 'Indica se a conta aceita rendimentos',
    example: 'true',
    required: false,
  })
  acceptIncomes: boolean;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true')
  @ApiProperty({
    description: 'Indica se a conta aceita pagamentos',
    example: 'false',
    required: false,
  })
  acceptPayments: boolean;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true')
  @ApiProperty({
    description: 'Indica se a conta tem controle de caixa',
    example: false,
    required: false,
  })
  cashControl?: boolean;

  // As inativas também (a tela de contas as separa); sem o filtro, só as ativas
  @IsOptional()
  @IsIn(['true', 'false', 'all'])
  @ApiProperty({ required: false, enum: ['true', 'false', 'all'] })
  isActive?: 'true' | 'false' | 'all';

  @IsOptional()
  @IsEnum(BankAccountKind)
  @ApiProperty({ required: false, enum: BankAccountKind })
  kind?: BankAccountKind;
}
