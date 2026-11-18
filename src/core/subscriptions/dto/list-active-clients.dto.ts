import {
  IsOptional,
  IsNumber,
  Min,
  IsIn,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ACCOUNT_TABS } from '../account-subscription';

const ACCOUNT_TAB_VALUES = [...ACCOUNT_TABS];
const PAID_PLAN_TYPES = ['START', 'LITE', 'PRO', 'ELITE', 'FULL'] as const;
const LISTED_BILLING_MODES = [
  'ASAAS_SUBSCRIPTION',
  'ASAAS_INSTALLMENT',
  'MANUAL',
] as const;

export class ListActiveClientsDto {
  @ApiPropertyOptional({ description: 'Página atual', default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Número de itens por página',
    default: 10,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number = 10;

  // A aba "Aguardando pagamento" entrou nos totais e ficou fora daqui: a
  // contagem mostrava a conta e a lista voltava 400, vazia.
  @ApiPropertyOptional({
    description: 'Filtrar por status (a aba de Gerenciar contas)',
    enum: ACCOUNT_TAB_VALUES,
  })
  @IsOptional()
  @IsString()
  @IsIn(ACCOUNT_TAB_VALUES)
  status?: string;

  @ApiPropertyOptional({
    description: 'Busca por nome da empresa, email ou telefone',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Ordenação dos resultados',
    enum: ['name', 'updated_at', 'created_at'],
    default: 'name',
  })
  @IsOptional()
  @IsString()
  @IsIn(['name', 'updated_at', 'created_at'])
  sort?: 'name' | 'updated_at' | 'created_at' = 'name';

  @ApiPropertyOptional({
    description:
      'Módulo contratado na assinatura em vigor: a chave do módulo, `any` (algum módulo) ou `none` (nenhum)',
    example: 'nota_fiscal',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  module?: string;

  @ApiPropertyOptional({
    description: 'Contas com ou sem usuários adicionais contratados',
    enum: ['with', 'without'],
  })
  @IsOptional()
  @IsIn(['with', 'without'])
  additionalUsers?: 'with' | 'without';

  @ApiPropertyOptional({
    description: 'Plano da assinatura em vigor',
    enum: PAID_PLAN_TYPES,
  })
  @IsOptional()
  @IsIn(PAID_PLAN_TYPES)
  plan?: (typeof PAID_PLAN_TYPES)[number];

  @ApiPropertyOptional({
    description:
      'Como a assinatura em vigor é cobrada: assinatura do Asaas, anual parcelado ou manual (sem cobrança)',
    enum: LISTED_BILLING_MODES,
  })
  @IsOptional()
  @IsIn(LISTED_BILLING_MODES)
  billingMode?: (typeof LISTED_BILLING_MODES)[number];

  @ApiPropertyOptional({
    description: 'UF do endereço principal da empresa',
    example: 'SC',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  state?: string;

  @ApiPropertyOptional({
    description:
      'Sem valor, a lista sai em grupos por data de contratação (formato da tela anterior); `none` devolve a lista sem grupos',
    enum: ['date', 'none'],
  })
  @IsOptional()
  @IsIn(['date', 'none'])
  groupBy?: 'date' | 'none';
}
