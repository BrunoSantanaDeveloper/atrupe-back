import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsString,
  IsUUID,
} from 'class-validator';
import { ItemType, PaymentSalaryStatus } from '@prisma/client';

export class AddSalaryItemDto {
  @ApiProperty({
    description: 'Tipo do item (Acréscimo, Desconto ou Adiantamento)',
    enum: ItemType,
    example: ItemType.INCREASE,
  })
  @IsEnum(ItemType)
  type: ItemType;

  @ApiProperty({
    description: 'Descrição do item (ex: Salário Base, Bonus, etc.)',
    example: 'Bonus de Férias',
  })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({
    description: 'Valor do item',
    example: 500.0,
  })
  @IsNumber()
  amount: number;

  @ApiProperty({
    description: 'ID da folha de pagamento à qual o item será adicionado',
    example: 'd5b0e414-6c7c-4b7a-88f3-5a3e216e1e2f',
  })
  @IsUUID()
  salarySheetId: string;
}

export class AddPaymentMovementDto {
  @ApiProperty({
    description: 'ID da folha de pagamento vinculada à movimentação',
    example: 'uuid-da-folha',
  })
  @IsUUID()
  salarySheetId: string;

  @ApiProperty({
    description: 'Valor da movimentação',
    example: 1000.0,
  })
  @IsNumber()
  amount: number;

  @ApiProperty({
    description: 'Data do pagamento',
    example: '2024-12-01',
  })
  @IsDateString()
  paidDate: string;

  @ApiProperty({
    description: 'ID da forma de pagamento',
    example: 'uuid-do-metodo-de-pagamento',
  })
  @IsUUID()
  paymentMethodId: string;

  @ApiProperty({
    description: 'Status do pagamento (PENDENTE ou PAGO)',
    enum: PaymentSalaryStatus,
    example: PaymentSalaryStatus.PENDING,
  })
  @IsEnum(PaymentSalaryStatus)
  paymentStatus: PaymentSalaryStatus;
}

export class PaySalaryMovementDto {
  @ApiProperty({
    description: 'ID da movimentação a ser paga',
    example: 'uuid-da-movimentacao',
  })
  @IsUUID()
  movementId: string;

  @ApiProperty({
    description: 'Data do pagamento',
    example: '2024-12-01',
  })
  @IsDateString()
  paidDate: string;

  @ApiProperty({
    description: 'Valor pago',
    example: 1000.0,
  })
  @IsNumber()
  paidAmount: number;

  @ApiProperty({
    description: 'ID do método de pagamento usado',
    example: 'uuid-do-metodo-de-pagamento',
  })
  @IsUUID()
  paymentMethodId: string;
}
