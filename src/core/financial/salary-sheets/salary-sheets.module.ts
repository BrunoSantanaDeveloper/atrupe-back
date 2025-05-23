import { Module } from '@nestjs/common';
import { SalarySheetsController } from './salary-sheets.controller';
import { SalarySheetsService } from './salary-sheets.service';

@Module({
  controllers: [SalarySheetsController],
  providers: [SalarySheetsService],
})
export class SalarySheetsModule {}
