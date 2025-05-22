import {
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
  Body,
} from '@nestjs/common';
import { ContractService } from './contract.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { Response, Request } from 'express';
import { CreateContractDto } from './dtos';

@Controller('contract')
export class ContractController {
  constructor(private readonly contractService: ContractService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  async createContract(@Body() createContractDto: CreateContractDto) {
    return this.contractService.createContract(createContractDto);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/accept')
  async acceptContract(@Param('id') id: string, @Req() req: Request) {
    console.log('acceptContract', req.user);

    return this.contractService.acceptContract({
      contractId: id,
      userId: '123',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  // @UseGuards(JwtAuthGuard)
  @Get('terms')
  async getTerms(@Res() res: Response) {
    return this.contractService.findContract(res);
  }
}
