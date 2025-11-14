export class CreateOrderHistoryDto {
  orderId: string;
  action: string;
  description: string;
  changes?: any;
  metadata?: any;
  createdBy: string;
  createdByName?: string;
}
