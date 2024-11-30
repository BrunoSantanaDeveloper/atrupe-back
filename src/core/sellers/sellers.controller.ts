import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { SellersService } from './sellers.service';

import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
const RESOURCE = 'sellers';
@ApiTags('Vendedores')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller(RESOURCE)
export class SellersController {
  constructor(private readonly sellersService: SellersService) {}

  // @Post()
  // create(@Body() createSellerDto: CreateSellerDto) {
  //   return this.sellersService.create(createSellerDto);
  // }

  @Get()
  findAll(@Req() req) {
    const companyId = req.user.companyId;
    return this.sellersService.findAll(companyId);
  }

  // @Get(':id')
  // findOne(@Param('id') id: string) {
  //   return this.sellersService.findOne(+id);
  // }

  // @Patch(':id')
  // update(@Param('id') id: string, @Body() updateSellerDto: UpdateSellerDto) {
  //   return this.sellersService.update(+id, updateSellerDto);
  // }

  // @Delete(':id')
  // remove(@Param('id') id: string) {
  //   return this.sellersService.remove(+id);
  // }
}
