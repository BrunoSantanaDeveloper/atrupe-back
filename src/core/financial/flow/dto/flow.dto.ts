import { ApiProperty } from '@nestjs/swagger';

class FinancialFlowTotal {
  @ApiProperty({
    description: 'Total de contas a pagar',
    example: 1500.5,
  })
  payables: number;

  @ApiProperty({
    description: 'Total de contas a receber',
    example: 3000.75,
  })
  receivables: number;
}

export class FinancialFlowResponse {
  @ApiProperty({
    description: 'Data do fluxo financeiro',
    example: '2023-06-01',
    type: 'string',
    format: 'date',
  })
  date: string;

  @ApiProperty({
    description: 'Itens do fluxo financeiro',
    type: 'array',
    items: { type: 'object' },
  })
  items: any[];

  @ApiProperty({
    description: 'Totais do fluxo financeiro',
    type: FinancialFlowTotal,
  })
  total: FinancialFlowTotal;
}
