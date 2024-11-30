import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { UpdateQuotationPaymentDto } from './dto/update-payment.dto';

@Injectable()
export class PaymentService {
  constructor(private readonly prisma: PrismaService) {}
  async findOne(id: string) {
    return this.prisma.quotationPayment.findUnique({
      where: { id },
      include: {
        paymentMethod: true,
        paymentCondition: true,
        commission: true,
        installments: true,
      },
    });
  }
  async update(
    id: string,
    updateQuotationPaymentDto: UpdateQuotationPaymentDto,
  ) {
    return this.prisma.quotationPayment.update({
      where: { id },
      data: { ...updateQuotationPaymentDto },
    });
  }

  //TODO: Fazer update de parcelas, fazer update de comissão
}
