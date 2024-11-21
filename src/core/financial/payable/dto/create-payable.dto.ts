import { PaymentStatus } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreatePayableDto {
  @IsNotEmpty()
  @IsNumberString()
  @ApiProperty({
    description: 'Valor da conta a pagar',
    example: '500.00',
  })
  amount: number;

  @IsNotEmpty()
  @IsDateString()
  @ApiProperty({
    description: 'Data de referência da conta a pagar',
    example: '2023-06-01',
    type: 'string', // Swagger espera uma string para datas
    format: 'date',
  })
  referenceDate: Date;

  @IsNotEmpty()
  @IsDateString()
  @ApiProperty({
    description: 'Data de vencimento da conta a pagar',
    example: '2023-07-01',
    type: 'string', // Swagger espera uma string para datas
    format: 'date',
  })
  dueDate: Date;

  @IsOptional()
  @IsEnum(PaymentStatus)
  @ApiProperty({
    description: 'Status do pagamento da conta a pagar',
    example: PaymentStatus.PENDING,
    enum: PaymentStatus,
    required: false,
  })
  status: PaymentStatus;

  @IsNotEmpty()
  @IsUUID()
  @ApiProperty({
    description: 'ID da empresa associada à conta a pagar',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  companyId: string;

  @IsNotEmpty()
  @IsUUID()
  @ApiProperty({
    description: 'ID do cliente associado à conta a pagar',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  clientId: string;

  @IsNotEmpty()
  @IsUUID()
  @ApiProperty({
    description: 'ID da conta bancária associada à conta a pagar',
    example: '123e4567-e89b-12d3-a456-426614174002',
  })
  bankAccountId: string;

  @IsNotEmpty()
  @IsUUID()
  @ApiProperty({
    description: 'ID do método de pagamento associado à conta a pagar',
    example: '123e4567-e89b-12d3-a456-426614174003',
  })
  paymentMethodId: string;

  @IsNotEmpty()
  @IsUUID()
  @ApiProperty({
    description: 'ID da categoria associada à conta a pagar',
    example: '123e4567-e89b-12d3-a456-426614174004',
  })
  categoryId: string;

  @IsNotEmpty()
  @IsUUID()
  @ApiProperty({
    description: 'ID da subcategoria associada à conta a pagar',
    example: '123e4567-e89b-12d3-a456-426614174005',
  })
  subCategoryId: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Descrição da conta a pagar',
    example: 'Pagamento de fornecedor',
    required: false,
  })
  description: string;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Referência da conta a pagar',
    example: 'REF123456',
  })
  reference: string;
}
