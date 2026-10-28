import { Transform } from 'class-transformer';
import { IsDate, IsIn, IsOptional, IsString } from 'class-validator';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';

/**
 * Os filtros que Contas a receber e Contas a pagar dividem com o Fluxo
 * financeiro (28/10/2026, LITE part3 item 2): período por vencimento ou por
 * pagamento, conta bancária e ordem. Antes as duas listas só filtravam por
 * forma de pagamento e status.
 */
export class InstallmentListFilterDto extends BaseFilterDTO {
  @IsOptional()
  @Transform(({ value }) => (value ? new Date(value) : undefined))
  @IsDate()
  startDate?: Date;

  @IsOptional()
  @Transform(({ value }) => (value ? new Date(value) : undefined))
  @IsDate()
  endDate?: Date;

  // O nome do período escolhido na tela (mês atual, próximos 7 dias...). As
  // datas já vêm calculadas em startDate e endDate; aqui é só aceito
  @IsOptional()
  @IsString()
  period?: string;

  @IsOptional()
  @IsIn(['dueDate', 'paidDate'])
  dateType?: 'dueDate' | 'paidDate';

  @IsOptional()
  @IsString()
  bankAccountId?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sort?: 'asc' | 'desc';
}

/**
 * O campo de data da lista e o where do período e da conta. Na visão por
 * pagamento só entram as parcelas pagas, agrupadas pela data do pagamento.
 */
export function installmentListWhere(dto: InstallmentListFilterDto) {
  const field: 'dueDate' | 'paidDate' =
    dto.dateType === 'paidDate' ? 'paidDate' : 'dueDate';
  const where: Record<string, unknown> = {};

  const range: { gte?: Date; lte?: Date; not?: null } = {};
  if (dto.startDate) {
    const start = new Date(dto.startDate);
    start.setUTCHours(0, 0, 0, 0);
    range.gte = start;
  }
  if (dto.endDate) {
    const end = new Date(dto.endDate);
    end.setUTCHours(23, 59, 59, 999);
    range.lte = end;
  }
  if (field === 'paidDate') range.not = null;
  if (Object.keys(range).length) where[field] = range;

  if (dto.bankAccountId) where.bankAccountId = dto.bankAccountId;

  return { field, where, sort: dto.sort === 'asc' ? 'asc' : 'desc' } as const;
}
