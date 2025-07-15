import { IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DuplicateQuotationDto {
  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID do cliente associado ao orçamento duplicado',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  clientId?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Nova descrição do orçamento a ser duplicado',
    example: 'Orçamento de teste duplicado',
    required: false,
  })
  description?: string;
}

// Exemplo de estrutura do DTO
export class DuplicateQuotationProductDto {
  quotationId: string;
  productId: string;
  quantity: number;
  description?: string;
  technicalDescription?: string;
  imageUrl?: string;
  notes?: string;
  totalValue?: number;
  finalValue?: number;
  discount?: number;
  discountType?: string;
  allowEditDescription?: boolean;
  allowEditValues?: boolean;
}

export class DuplicateQuotationProductItemDto {
  quotationProductId: string;
  quotationId: string;
  productId: string;
  productItemId: string;
  name: string;
  quantity: number;
  originalQuantity?: number;
  unitOfMeasureId: string;
  unitKind?: string;
  width?: number;
  height?: number;
  length?: number;
  weight?: number;
  volume?: number;
  distance?: number;
  duration?: number;
  notes?: string;
  unitCost?: number;
  salePrice?: number;
  totalValue?: number;
}
