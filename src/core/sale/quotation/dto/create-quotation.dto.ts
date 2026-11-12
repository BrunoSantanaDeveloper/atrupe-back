import { PrintSpecDto } from '../../../print/print.dto';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { SaleChoicesDto } from '../../../assembly/dto/sale.dto';

export class QuotationProductItemDto {
  @IsUUID()
  @ApiProperty({
    description: 'ID do item do produto',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  productItemId: string;

  @IsString()
  @ApiProperty({
    description: 'Nome do item do produto',
    example: 'Item Exemplo',
  })
  name: string;

  @IsUUID()
  @IsOptional()
  @ApiProperty({
    description: 'ID da unidade de medida do item',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsString()
  @ApiProperty({
    description: 'Tipo da unidade de medida do item',
    enum: [
      'LENGTH',
      'WEIGHT',
      'CAPACITY',
      'DISTANCE',
      'DURATION',
      'UNITY',
      'AREA',
    ],
    example: 'AREA',
  })
  unitKind: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @ApiProperty({
    description: 'Largura do item',
    example: 15.5,
    required: false,
  })
  width?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @ApiProperty({
    description: 'Altura do item',
    example: 20.0,
    required: false,
  })
  height?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @ApiProperty({
    description: 'Comprimento do item',
    example: 30.0,
    required: false,
  })
  length?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @ApiProperty({
    description: 'Peso do item',
    example: 5.0,
    required: false,
  })
  weight?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @ApiProperty({
    description: 'Volume do item',
    example: 50.0,
    required: false,
  })
  volume?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @ApiProperty({
    description: 'Distância relacionada ao item',
    example: 100.0,
    required: false,
  })
  distance?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @ApiProperty({
    description: 'Duração relacionada ao item (em segundos)',
    example: 3600,
    required: false,
  })
  duration?: number;

  @IsNumber()
  @Min(0)
  @ApiProperty({
    description: 'Quantidade do item do produto',
    example: 10,
  })
  quantity: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @ApiProperty({
    description: 'Custo unitário do item',
    example: 10.0,
    required: false,
  })
  unitCost?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @ApiProperty({
    description: 'Preço de venda do item',
    example: 20.0,
    required: false,
  })
  salePrice?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @ApiProperty({
    description: 'Valor total do item',
    example: 200.0,
    required: false,
  })
  totalValue?: number;
}

export class QuotationProductDto {
  @IsUUID()
  @ApiProperty({
    description: 'ID do produto',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  productId: string;

  @IsNotEmpty()
  @Min(1)
  @ApiProperty({
    description: 'Quantidade do produto',
    example: 2,
  })
  quantity: number;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'Descrição do produto',
    example: 'Produto com características especiais.',
    required: false,
  })
  description?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'Descrição técnica do produto',
    example: 'Descrição técnica detalhada.',
    required: false,
  })
  technicalDescription?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'URL da imagem do produto',
    example: 'https://example.com/image.png',
    required: false,
  })
  imageUrl?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'Tamanho da imagem no PDF (small ou large)',
    example: 'small',
    enum: ['small', 'large'],
    required: false,
  })
  imageSize?: 'small' | 'large';

  @IsNumber()
  @Min(0)
  @IsOptional()
  @ApiProperty({
    description: 'Valor total do produto',
    example: 500.0,
    required: false,
  })
  totalValue?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuotationProductItemDto)
  @ApiProperty({
    description: 'Itens do produto',
    type: [QuotationProductItemDto],
  })
  items: QuotationProductItemDto[];

  @IsOptional()
  @ApiProperty({
    description: 'Permitir edição da descrição do produto',
    example: true,
    required: false,
  })
  allowEditDescription?: boolean;

  @IsOptional()
  @ApiProperty({
    description: 'Permitir edição dos valores do produto',
    example: true,
    required: false,
  })
  allowEditValues?: boolean;
}

export class CreateQuotationDto {
  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID do cliente associado ao orçamento',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  clientId?: string;

  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsUUID()
  @IsOptional()
  @ApiProperty({
    description: 'ID do contato/responsável do cliente associado ao orçamento',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  contactId?: string;

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID da série do orçamento',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  seriesId?: string;

  // A tela reenvia o cabeçalho inteiro e manda '' no atendimento que o
  // documento não tem — caso de todo documento migrado. `@IsOptional` só
  // ignora null e undefined, então o '' caía no `@IsUUID` e nada salvava.
  // Vazio vira nulo, como o `contactId` acaba ficando: documento sem
  // atendimento, e não "campo não enviado".
  @Transform(({ value }) => (value === '' ? null : value))
  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID da fonte de contato do orçamento',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  contactSourceId?: string;

  @IsNotEmpty()
  @IsUUID()
  @ApiProperty({
    description: 'ID da empresa associada ao orçamento',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  companyId: string;

  subCompanyId: string;

  @IsNotEmpty()
  @IsUUID()
  @ApiProperty({
    description: 'ID do vendedor associado ao orçamento',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  sellerId: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Descrição do orçamento',
    example: 'Este é um orçamento de exemplo.',
    required: false,
  })
  description?: string;

  @IsOptional()
  @IsNumber()
  @ApiProperty({
    description: 'Valor total do orçamento',
    example: 1500.0,
    required: false,
  })
  totalValue?: number;

  @IsOptional()
  @IsBoolean()
  @ApiProperty({
    description: 'É venda rápida',
    example: false,
  })
  quickSale?: boolean;

  @IsOptional()
  @IsDateString()
  @ApiProperty({
    description: 'Data de criação retroativa (somente admin)',
    example: '2024-01-15T10:00:00.000Z',
    required: false,
  })
  createdAt?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @ApiProperty({
    description: 'Número do orçamento (somente admin, para casos de migração)',
    example: 42,
    required: false,
  })
  quotationNumber?: number;

  // @IsArray()
  // @ValidateNested({ each: true })
  // @Type(() => QuotationProductDto)
  // @ApiProperty({
  //   description: 'Produtos incluídos no orçamento',
  //   type: [QuotationProductDto],
  // })
  // products: QuotationProductDto[];
}

export class AddProductItemDto {
  @IsUUID()
  @IsOptional()
  @ApiProperty({
    description: 'ID do item do produto',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'Tipo da unidade de medida do item',
    enum: [
      'LENGTH',
      'WEIGHT',
      'CAPACITY',
      'DISTANCE',
      'DURATION',
      'UNITY',
      'AREA',
    ],
    example: 'AREA',
  })
  unitKind: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @ApiProperty({ description: 'Quantidade do item', example: 10 })
  quantity: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @ApiProperty({ description: 'Quantidade original do item', example: 1 })
  originalQuantity?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiProperty({ description: 'Largura', example: 10.0 })
  width: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiProperty({ description: 'Altura', example: 5.0 })
  height: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiProperty({ description: 'Comprimento', example: 20.0 })
  length: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiProperty({ description: 'Peso', example: 2.5 })
  weight: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiProperty({ description: 'Volume', example: 100.0 })
  volume: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiProperty({ description: 'Distância', example: 50.0 })
  distance: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiProperty({ description: 'Duração (em segundos)', example: 3600 })
  duration: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiProperty({ description: 'Custo unitário', example: 15.0 })
  unitCost: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiProperty({ description: 'Preço de venda', example: 30.0 })
  salePrice: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiProperty({
    description: 'Valor total do item (calculado no frontend)',
    example: 600.0,
  })
  totalValue?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiProperty({
    description: 'Medida calculada (ex: width * height para AREA)',
    example: 50.0,
  })
  measurement?: number;
}

export class AddItemDto {
  @IsUUID()
  @ApiProperty({
    description: 'ID do produto',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  productId: string;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'Descrição do produto',
    example: 'Descrição customizada',
  })
  description?: string;

  @Min(1)
  @ApiProperty({ description: 'Quantidade do produto', example: 2 })
  quantity: number;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'URL da imagem do produto',
    example: 'https://example.com/image.png',
  })
  imageUrl?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'Tamanho da imagem no PDF (small ou large)',
    example: 'small',
    enum: ['small', 'large'],
  })
  imageSize?: 'small' | 'large';

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'Descrição técnica do produto',
    example: 'Descrição técnica',
  })
  technicalDescription?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiProperty({
    description: 'Valor total do produto (calculado no frontend)',
    example: 500.0,
  })
  totalValue?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiProperty({
    description: 'Valor final após desconto (calculado no frontend)',
    example: 450.0,
  })
  finalValue?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiProperty({ description: 'Valor do desconto', example: 50.0 })
  discount?: number;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Tipo do desconto (VALUE ou PERCENT)',
    example: 'VALUE',
  })
  discountType?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Observações do produto',
    example: 'Observações importantes',
  })
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddProductItemDto)
  @ApiProperty({ description: 'Itens do produto', type: [AddProductItemDto] })
  items: AddProductItemDto[];

  // A variação escolhida (PV-3, PV-6): o produto com variações exige uma
  @IsOptional()
  @IsUUID('all', { message: 'Variação não encontrada' })
  @ApiProperty({ required: false, description: 'A variação do produto' })
  variationId?: string;

  // As escolhas do vendedor na composição (IP-36): exige o recurso de
  // composição do plano
  @IsOptional()
  @ValidateNested()
  @Type(() => SaleChoicesDto)
  @ApiProperty({ required: false, type: SaleChoicesDto })
  composition?: SaleChoicesDto;

  // Sangria, bloco e apostila deste item (gráfica rápida, 12/11/2026); nulo
  // volta ao que o produto define
  @IsOptional()
  @ValidateNested()
  @Type(() => PrintSpecDto)
  @ApiProperty({ required: false, type: PrintSpecDto, nullable: true })
  printSpec?: PrintSpecDto | null;
}
