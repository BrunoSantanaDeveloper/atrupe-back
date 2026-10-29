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
 * pagamento só entram as parcelas pagas ou provisionadas, pela mesma data
 * que o Fluxo financeiro usa (installmentListDate).
 */
export function installmentListWhere(dto: InstallmentListFilterDto) {
  const field: 'dueDate' | 'paidDate' =
    dto.dateType === 'paidDate' ? 'paidDate' : 'dueDate';
  const where: Record<string, unknown> = {};

  let range: { gte?: Date; lte?: Date } | null = null;
  if (dto.startDate) {
    const start = new Date(dto.startDate);
    start.setUTCHours(0, 0, 0, 0);
    range = { ...range, gte: start };
  }
  if (dto.endDate) {
    const end = new Date(dto.endDate);
    end.setUTCHours(23, 59, 59, 999);
    range = { ...range, lte: end };
  }

  if (field === 'paidDate') {
    // Como no Fluxo: a provisionada (paidDate só sai na compensação) vale
    // pelo provisionDate, e a compensada também, que é a data exibida
    where.AND = [
      {
        OR: range
          ? [{ provisionDate: range }, { provisionDate: null, paidDate: range }]
          : [{ provisionDate: { not: null } }, { paidDate: { not: null } }],
      },
    ];
  } else if (range) {
    where.dueDate = range;
  }

  if (dto.bankAccountId) where.bankAccountId = dto.bankAccountId;

  return { field, where, sort: dto.sort === 'asc' ? 'asc' : 'desc' } as const;
}

interface InstallmentDates {
  id: string;
  dueDate: Date;
  paidDate: Date | null;
  provisionDate: Date | null;
}

/** A data que posiciona a parcela na lista, a mesma do Fluxo financeiro */
export function installmentListDate(
  installment: Omit<InstallmentDates, 'id'>,
  field: 'dueDate' | 'paidDate',
): Date | null {
  return field === 'paidDate'
    ? (installment.provisionDate ?? installment.paidDate)
    : installment.dueDate;
}

/**
 * As parcelas que passam no filtro, agrupadas por dia (como no Fluxo: a
 * data gravada com hora cai no dia dela, não num grupo só seu), na ordem
 * pedida. Devolve o total de dias e os da página, com os ids das parcelas
 * de cada um. A data do grupo é a da primeira parcela, como gravada.
 */
export function pageInstallmentDays(
  installments: InstallmentDates[],
  field: 'dueDate' | 'paidDate',
  sort: 'asc' | 'desc',
  page: number,
  limit: number,
) {
  const byDay = new Map<string, { date: Date; ids: string[] }>();
  for (const installment of installments) {
    const date = installmentListDate(installment, field);
    if (!date) continue;
    const day = new Date(date);
    day.setUTCHours(0, 0, 0, 0);
    const key = day.toISOString();
    const group = byDay.get(key);
    if (group) group.ids.push(installment.id);
    else byDay.set(key, { date, ids: [installment.id] });
  }

  const days = [...byDay.entries()]
    .sort(([a], [b]) =>
      sort === 'asc' ? a.localeCompare(b) : b.localeCompare(a),
    )
    .map(([key, group]) => ({ key, ...group }));
  const start = (page - 1) * limit;
  return { total: days.length, days: days.slice(start, start + limit) };
}
