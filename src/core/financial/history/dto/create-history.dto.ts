export class CreateReceivableHistoryDto {
  receivableId: string;
  action: string;
  description: string;
  changes?: any;
  metadata?: any;
  createdBy: string;
  createdByName?: string;
}

export class CreatePayableHistoryDto {
  payableId: string;
  action: string;
  description: string;
  changes?: any;
  metadata?: any;
  createdBy: string;
  createdByName?: string;
}
