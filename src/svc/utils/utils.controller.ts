import { Controller, Get, Post, Param, UseGuards, Query } from '@nestjs/common';
import { UtilsService } from './utils.service';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';

const RESOURCE = 'utils';
@UseGuards(JwtAuthGuard)
@Controller(RESOURCE)
export class UtilsController {
  constructor(private readonly utilsService: UtilsService) {}

  @Get('/states')
  states() {
    return this.utilsService.states();
  }

  @Post('/states')
  createStates() {
    return this.utilsService.createStates();
  }

  @Get('/zipcode/:zipcode')
  zipcode(@Param('zipcode') zipcode: string) {
    return this.utilsService.zipcode(zipcode);
  }

  @Get('/cities')
  cities(@Query('state') state: string) {
    return this.utilsService.cities(state);
  }

  @Get('/cities/:id')
  city(@Param('id') id: string) {
    return this.utilsService.city(id);
  }

  @Post('/cities')
  createCities() {
    return this.utilsService.createCity();
  }
}
