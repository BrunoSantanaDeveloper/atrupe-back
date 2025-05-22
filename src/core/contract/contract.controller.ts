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

interface RequestWithUser extends Request {
  user: {
    userId: string;
    username: string;
    companyId: string;
    role: string;
    isAdmin: boolean;
  };
}

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
  async acceptContract(@Param('id') id: string, @Req() req: RequestWithUser) {
    // 6e08aa1f-a0dc-4bbc-b478-1bc6306bd834
    return this.contractService.acceptContract({
      contractId: id,
      userId: req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get('terms')
  async getTerms(@Res() res: Response) {
    return this.contractService.findContract(res);
  }
}
