export class ReportMenuDto {
  sales: {
    quotations: number;
    orders: number;
  };

  financial: {
    receivable: number;
    payable: number;
  };

  production: {
    followUp: number;
    production: number;
  };
}
