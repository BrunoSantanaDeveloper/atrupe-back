import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AsaasPaymentStatus, BillingType } from '@prisma/client';

export class PaymentResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  asaasPaymentId: string;

  @ApiProperty()
  value: number;

  @ApiProperty()
  dueDate: Date;

  @ApiProperty({ enum: BillingType })
  billingType: BillingType;

  @ApiProperty({ enum: AsaasPaymentStatus })
  status: AsaasPaymentStatus;

  @ApiPropertyOptional()
  description?: string;

  @ApiPropertyOptional()
  invoiceUrl?: string;

  @ApiPropertyOptional()
  bankSlipUrl?: string;

  @ApiPropertyOptional()
  pixQrCode?: string;

  @ApiPropertyOptional()
  pixCopyPaste?: string;

  @ApiProperty()
  createdAt: Date;

  @ApiPropertyOptional()
  confirmedDate?: Date;

  @ApiPropertyOptional()
  paymentDate?: Date;
}
