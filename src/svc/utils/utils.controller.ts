import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { UtilsService } from './utils.service';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { PermissionsGuard } from 'src/core/auth/abac/permissions.guard';
import { HasAnyPermission } from 'src/core/auth/abac/has-any-permission.decorator';
import { DOCUMENT_LOOKUP_PERMISSIONS } from 'src/core/auth/abac/document-lookup.permissions';

const RESOURCE = 'utils';
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller(RESOURCE)
export class UtilsController {
  constructor(private readonly utilsService: UtilsService) {}

  // @Get('/states')
  // states() {
  //   return this.utilsService.states();
  // }

  // @Post('/states')
  // createStates() {
  //   return this.utilsService.createStates();
  // }

  @Get('/zipcode/:zipcode')
  zipcode(@Param('zipcode') zipcode: string) {
    return this.utilsService.zipcode(zipcode);
  }

  // A consulta de CPF e de CNPJ é paga e devolve dado pessoal: só para
  // quem cadastra cliente, fornecedor ou colaborador, ou emite nota
  @Get('/people/:cpf')
  @HasAnyPermission(...DOCUMENT_LOOKUP_PERMISSIONS)
  people(@Param('cpf') cpf: string) {
    return this.utilsService.people(cpf);
  }

  @Get('/company/:cnpj')
  @HasAnyPermission(...DOCUMENT_LOOKUP_PERMISSIONS)
  company(@Param('cnpj') cnpj: string) {
    return this.utilsService.company(cnpj);
  }

  // @Get('/cities')
  // cities(@Query('state') state: string) {
  //   return this.utilsService.cities(state);
  // }

  // @Get('/cities/:id')
  // city(@Param('id') id: string) {
  //   return this.utilsService.city(id);
  // }

  // @Post('/cities')
  // createCities() {
  //   return this.utilsService.createCity();
  // }
}
