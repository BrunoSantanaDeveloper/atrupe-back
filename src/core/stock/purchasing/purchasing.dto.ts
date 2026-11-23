import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PurchaseOrderStatus,
  PurchaseRequestStatus,
  StockLotMeasure,
  StockLotStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MESSAGE = { message: 'Data inválida' };

/* ------------------------------------------------------ solicitação */

export class PurchaseRequestFilterDto {
  @ApiPropertyOptional({ enum: PurchaseRequestStatus })
  @IsOptional()
  @IsEnum(PurchaseRequestStatus)
  status?: PurchaseRequestStatus;

  @ApiPropertyOptional({ description: 'Só as minhas' })
  @IsOptional()
  @IsString()
  mine?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class PurchaseRequestDto {
  @ApiPropertyOptional({ description: 'Sem material, vale a descrição' })
  @IsOptional()
  @IsUUID('all', { message: 'Material não encontrado' })
  materialId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all', { message: 'Variação não encontrada' })
  variationId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @ApiProperty()
  @IsNumber({}, { message: 'Informe a quantidade' })
  @Min(0.0001, { message: 'Informe a quantidade' })
  quantity: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @ApiPropertyOptional({ example: '2026-11-30' })
  @IsOptional()
  @Matches(DAY, DAY_MESSAGE)
  neededBy?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class CancelDto {
  @ApiProperty()
  @IsString()
  @MaxLength(300)
  reason: string;
}

/* ---------------------------------------------------------- cotação */

export class PurchaseQuoteDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all', { message: 'Fornecedor não encontrado' })
  supplierId?: string | null;

  @ApiPropertyOptional({ description: 'Sem o cadastro, o nome' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  supplierName?: string;

  @ApiPropertyOptional({ description: 'Sem ela, a da solicitação' })
  @IsOptional()
  @IsNumber()
  @Min(0.0001)
  quantity?: number;

  @ApiProperty({ description: 'Centavos por unidade' })
  @IsInt({ message: 'O preço vai em centavos' })
  @Min(0)
  unitPrice: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  deliveryDays?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  paymentTerms?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DAY, DAY_MESSAGE)
  validUntil?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

/* ----------------------------------------------------------- pedido */

export class CloseOrderDto {
  @ApiProperty({ type: [String], description: 'Uma cotação por solicitação' })
  @IsArray()
  @ArrayMinSize(1, { message: 'Escolha as cotações' })
  @IsUUID('all', { each: true })
  quoteIds: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DAY, DAY_MESSAGE)
  expectedAt?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class OrderItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all')
  materialId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all')
  variationId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @ApiProperty()
  @IsNumber({}, { message: 'Informe a quantidade' })
  @Min(0.0001, { message: 'Informe a quantidade' })
  quantity: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @ApiProperty({ description: 'Centavos por unidade' })
  @IsInt({ message: 'O preço vai em centavos' })
  @Min(0)
  unitPrice: number;
}

/** O pedido feito direto, sem solicitação nem cotação. */
export class PurchaseOrderDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all', { message: 'Fornecedor não encontrado' })
  supplierId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  supplierName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DAY, DAY_MESSAGE)
  expectedAt?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @ApiProperty({ type: [OrderItemDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Inclua ao menos um item' })
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];
}

export class PurchaseOrderFilterDto {
  @ApiPropertyOptional({ enum: PurchaseOrderStatus })
  @IsOptional()
  @IsEnum(PurchaseOrderStatus)
  status?: PurchaseOrderStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class CheckItemDto {
  @ApiProperty()
  @IsUUID('all')
  itemId: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  receivedQuantity: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  divergence?: string | null;
}

/** A conferência (ES-13): o que chegou de cada item e a nota, se houver. */
export class CheckOrderDto {
  @ApiProperty({ type: [CheckItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CheckItemDto)
  items: CheckItemDto[];

  @ApiPropertyOptional({ description: 'A nota de entrada do fornecedor' })
  @IsOptional()
  @IsUUID('all', { message: 'Nota não encontrada' })
  invoiceId?: string | null;
}

export class LotPlanDto {
  @ApiProperty()
  @IsUUID('all')
  itemId: string;

  @ApiProperty({ enum: StockLotMeasure })
  @IsEnum(StockLotMeasure)
  measure: StockLotMeasure;

  @ApiProperty({ description: 'Quantos lotes (rolos, chapas) chegaram' })
  @IsInt()
  @Min(1)
  @Max(500)
  count: number;

  @ApiPropertyOptional({ description: 'Metros' })
  @IsOptional()
  @IsNumber()
  @Min(0.001)
  width?: number | null;

  @ApiPropertyOptional({ description: 'Metros' })
  @IsOptional()
  @IsNumber()
  @Min(0.001)
  length?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  brand?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  color?: string;
}

/** Lançar no estoque: com os lotes de cada item, quando houver. */
export class ReceiveOrderDto {
  @ApiPropertyOptional({ type: [LotPlanDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LotPlanDto)
  lots?: LotPlanDto[];
}

export class PayablesDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(48)
  installments: number;

  @ApiProperty({ example: '2026-12-10' })
  @Matches(DAY, DAY_MESSAGE)
  firstDue: string;

  @ApiPropertyOptional({ default: 30 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  everyDays?: number;
}

/* ------------------------------------------------------------- lote */

export class StockLotFilterDto {
  @ApiPropertyOptional({ description: 'Os abertos num setor' })
  @IsOptional()
  @IsUUID('all')
  sectorId?: string;

  @ApiPropertyOptional({ description: 'ativos, encerrados ou todos' })
  @IsOptional()
  @IsString()
  view?: 'active' | 'closed' | 'all';

  @ApiPropertyOptional({ enum: StockLotStatus })
  @IsOptional()
  @IsEnum(StockLotStatus)
  status?: StockLotStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

/** O lote lançado à mão (o rolo que já estava no estoque). */
export class StockLotDto {
  @ApiProperty()
  @IsUUID('all', { message: 'Material não encontrado' })
  materialId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all')
  variationId?: string | null;

  @ApiProperty({ enum: StockLotMeasure })
  @IsEnum(StockLotMeasure)
  measure: StockLotMeasure;

  @ApiProperty({ description: 'Na unidade do material' })
  @IsNumber()
  @Min(0.0001, { message: 'Informe a quantidade' })
  quantity: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0.001)
  width?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0.001)
  length?: number | null;

  @ApiProperty({ description: 'Centavos, o lote inteiro' })
  @IsInt()
  @Min(0)
  cost: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  supplierName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  brand?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  color?: string;

  @ApiPropertyOptional({
    description:
      'Lançar também no saldo do estoque (o lote novo, não o que já estava)',
  })
  @IsOptional()
  enterStock?: boolean;
}

export class LotUseDto {
  @ApiPropertyOptional({ description: 'Rolo: metros que saíram' })
  @IsOptional()
  @IsNumber()
  @Min(0.001)
  length?: number;

  @ApiPropertyOptional({ description: 'A sobra medida: largura atual' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  remainingWidth?: number;

  @ApiPropertyOptional({ description: 'A sobra medida: comprimento atual' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  remainingLength?: number;

  @ApiPropertyOptional({ description: 'Por quantidade' })
  @IsOptional()
  @IsNumber()
  @Min(0.0001)
  quantity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class LotSplitDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0.001)
  length?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0.001)
  width?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0.0001)
  quantity?: number;
}

export class LotOpenDto {
  @ApiPropertyOptional({ description: 'Sem ele, o setor do material' })
  @IsOptional()
  @IsUUID('all', { message: 'Setor não encontrado' })
  sectorId?: string | null;
}

/** A baixa do impressor na tarefa (ES-16). */
export class TaskLotUseDto {
  @ApiProperty()
  @IsUUID('all', { message: 'Lote não encontrado' })
  lotId: string;

  @ApiPropertyOptional({ description: 'Rolo: metros (a largura é a do rolo)' })
  @IsOptional()
  @IsNumber()
  @Min(0.001)
  length?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0.0001)
  quantity?: number;

  @ApiPropertyOptional({
    description:
      'O material vendido que a baixa substitui (material|variação); nulo, nenhum',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  replaces?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}
