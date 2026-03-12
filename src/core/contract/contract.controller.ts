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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

interface RequestWithUser extends Request {
  user: {
    userId: string;
    username: string;
    companyId: string;
    role: string;
    isAdmin: boolean;
  };
}

@ApiTags('Contratos')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
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

  @UseGuards(JwtAuthGuard)
  @Get('accepted')
  async getAcceptedContract(@Req() req: RequestWithUser) {
    return this.contractService.getAcceptedContract(req.user.userId);
  }
}
