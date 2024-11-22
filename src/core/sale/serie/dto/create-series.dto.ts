import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsInt, IsOptional } from 'class-validator';

export class CreateSaleSeriesDto {
  @ApiProperty({
    description: 'Código único da série de vendas.',
    example: 'T1',
  })
  @IsString()
  code: string;

  @ApiProperty({
    description: 'Descrição da série de vendas.',
    example: 'Treinamento',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    description: 'Título da série de vendas.',
    example: 'Orçamento',
  })
  @IsString()
  title: string;

  @ApiProperty({
    description: 'Validade da proposta em dias.',
    example: 6,
  })
  @IsInt()
  @IsOptional()
  proposalValidity?: number;

  @ApiProperty({
    description: 'Prazo de entrega em dias.',
    example: 6,
  })
  @IsInt()
  @IsOptional()
  deliveryDeadline?: number;

  @ApiProperty({
    description: 'Informação de faturamento.',
    example: 'na-entrega',
  })
  @IsString()
  @IsOptional()
  billing?: string;

  @ApiProperty({
    description: 'Opção de envio para produção.',
    example: 'enviar-diretamente',
  })
  @IsString()
  @IsOptional()
  sendToProduction?: string;

  @ApiProperty({
    description: 'Status de produção.',
    example: 'entrar-em-producao',
  })
  @IsString()
  @IsOptional()
  productionStatus?: string;

  @ApiProperty({
    description: 'Texto a ser incluído antes dos itens.',
    example: 'Segue abaixo confome sua solicitação:',
  })
  @IsString()
  @IsOptional()
  textBeforeItems?: string;

  @ApiProperty({
    description: 'Texto a ser incluído após os itens.',
    example:
      '1) Crédito e condição de pagamento sujeito à aprovação;\n\n2) Impressos c/ alta exigência colorimétrica exige-se prova de cor;\n\n3) Não nos responsabilizamos por características e especificações dos projetos gráficos fornecidos pelo cliente;',
  })
  @IsString()
  @IsOptional()
  textAfterItems?: string;
  isActive?: boolean;

  companyId: string;
}
