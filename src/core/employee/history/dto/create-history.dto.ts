export class CreateEmployeeHistoryDto {
  employeeId: string;
  action: string;
  description: string;
  changes?: any;
  metadata?: any;
  createdBy: string;
  createdByName?: string;
}
