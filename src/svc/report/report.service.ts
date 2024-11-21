import { Injectable } from '@nestjs/common';
import { ReportMenuDto } from './dto/menu.dto';
import { QuotationService } from '../../core/sale/quotation/quotation.service';
import { OrderService } from '../../core/sale/order/order.service';
import { PayableService } from '../../core/financial/payable/payable.service';
import { ReceivableService } from '../../core/financial/receivable/receivable.service';

@Injectable()
export class ReportService {
  constructor(
    private readonly quotationService: QuotationService,
    private readonly orderService: OrderService,
    private readonly payableService: PayableService,
    private readonly receivableService: ReceivableService,
  ) {}

  async menu(): Promise<ReportMenuDto> {
    const quotations = await this.quotationService.count();
    const orders = await this.orderService.count();
    const payable = await this.payableService.count();
    const receivable = await this.receivableService.count();
    return {
      sales: {
        quotations: quotations,
        orders: orders,
      },
      financial: {
        receivable: receivable,
        payable: payable,
      },
      production: {
        followUp: 0,
        production: 0,
      },
    };
  }
}
