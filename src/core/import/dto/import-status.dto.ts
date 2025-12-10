import { ImportStatus } from '@prisma/client';

export class ImportStatusDto {
  id: string;
  entity: string;
  status: ImportStatus;
  fileName: string;
  totalRows: number;
  successRows: number;
  failedRows: number;
  progress: number;
  errors?: any[];
  startedAt?: Date;
  completedAt?: Date;
  estimatedTimeRemaining?: number;
}
