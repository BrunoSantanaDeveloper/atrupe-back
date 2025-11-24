export class UserDto {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
}

export class UnifiedHistoryItemDto {
  id: string;
  type: 'quotation' | 'order' | 'receivable' | 'payable';
  entityId: string;
  action: string;
  description: string;
  changes: any;
  metadata: any;
  createdBy: string;
  createdByName: string | null;
  createdAt: Date;
  user: UserDto | null;
}

export class SaleHistoryResponseDto {
  total: number;
  quotationId: string;
  orderId: string | null;
  history: UnifiedHistoryItemDto[];
}
