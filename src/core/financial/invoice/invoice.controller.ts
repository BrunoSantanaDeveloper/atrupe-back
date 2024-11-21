import {
  Controller,
  Post,
  Body,
  UseGuards,
  Res,
  HttpStatus,
} from '@nestjs/common';
import { InvoiceService } from './invoice.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';

const RESOURCE = 'invoice';
const GROUP = 'financial';
@UseGuards(JwtAuthGuard)
@Controller(`${GROUP}/${RESOURCE}`)
@ApiTags('Faturas')
export class InvoiceController {
  constructor(private readonly invoiceService: InvoiceService) {}

  @Post()
  async create(
    @Body() createInvoiceDto: CreateInvoiceDto,
    @Res() res: Response,
  ) {
    try {
      const buffer = await this.invoiceService.create(createInvoiceDto);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="download.pdf"`,
      );
      res.send(buffer);
    } catch (error) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).send('Error generating PDF');
    }
  }

  // @Get()
  // findAll() {
  //   return this.invoiceService.findAll();
  // }

  // @Get(':id')
  // findOne(@Param('id') id: string) {
  //   return this.invoiceService.findOne(id);
  // }

  // @Patch(':id')
  // update(@Param('id') id: string, @Body() updateInvoiceDto: UpdateInvoiceDto) {
  //   return this.invoiceService.update(id, updateInvoiceDto);
  // }

  // @Delete(':id')
  // remove(@Param('id') id: string) {
  //   return this.invoiceService.remove(id);
  // }
}
