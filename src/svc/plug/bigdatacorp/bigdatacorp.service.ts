import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { PeopleResponse } from '../dto/people.dto';
import { CompanyResponse } from '../dto/company.dto';
import { PeopleResponseApi } from './dto/people.dto';
import { CompanyResponseApi } from './dto/company.dto';
import { firstValueFrom, map } from 'rxjs';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class BigdatacorpService {
  private readonly baseUrl = 'https://plataforma.bigdatacorp.com.br';
  private readonly timeout = 15000;
  private readonly retryAttempts = 3;

  constructor(
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
  ) {}

  async people(cpf: string): Promise<PeopleResponse> {
    const sanitizedCpf = cpf.replace(/[.-]/g, '');
    const body = {
      Datasets: 'basic_data',
      q: `doc{${sanitizedCpf}}`,
      Limit: 1,
    };

    const response$ = this.httpService
      .post<PeopleResponseApi>(`${this.baseUrl}/pessoas`, body, {
        timeout: this.timeout,
        headers: {
          AccessToken: this.config.get('plug.bigDataCorp.token'),
          TokenId: this.config.get('plug.bigDataCorp.clientId'),
        },
      })
      .pipe(map((response) => this.mapPeopleResponse(response.data)));

    return await firstValueFrom(response$);
  }

  /***************************************************************************/
  // Not implemented methods
  /***************************************************************************/

  async company(cnpj: string): Promise<CompanyResponse> {
    const sanitizedCnpj = cnpj.replace(/[./-]/g, '');
    const body = {
      Datasets: 'basic_data',
      q: `doc{${sanitizedCnpj}}`,
      Limit: 1,
    };

    const response$ = this.httpService
      .post<CompanyResponseApi>(`${this.baseUrl}/empresas`, body, {
        timeout: this.timeout,
        headers: {
          AccessToken: this.config.get('plug.bigDataCorp.token'),
          TokenId: this.config.get('plug.bigDataCorp.clientId'),
        },
      })
      .pipe(map((response) => this.mapCompanyResponse(response.data)));

    return await firstValueFrom(response$);
  }

  async zipcode(zipCode: string): Promise<any> {
    throw new Error('Method not implemented. Data: ' + zipCode);
  }

  async banks(): Promise<any> {
    throw new Error('Method not implemented.');
  }

  async bank(code: string): Promise<any> {
    throw new Error('Method not implemented. Data: ' + code);
  }

  async states(): Promise<any> {
    throw new Error('Method not implemented.');
  }

  async cities(state: string): Promise<any> {
    throw new Error('Method not implemented. Data: ' + state);
  }

  /***************************************************************************/
  // Private methods
  /***************************************************************************/

  private mapPeopleResponse(
    response: PeopleResponseApi,
  ): PeopleResponse | null {
    if (!response.Result || response.Result.length === 0) {
      return null;
    }
    return {
      name: response.Result[0].BasicData.Name,
      cpf: response.Result[0].BasicData.TaxIdNumber,
      birthdate: response.Result[0].BasicData.BirthDate,
      motherName: response.Result[0].BasicData.MotherName,
      address: {
        street: '',
        city: '',
        state: '',
        zipcode: '',
        country: '',
        neighborhood: '',
      },
    };
  }

  private mapCompanyResponse(
    response: CompanyResponseApi,
  ): CompanyResponse | null {
    if (!response.Result || response.Result.length === 0) {
      return null;
    }
    const result = response.Result[0];
    return {
      name: result.BasicData.Name,
      legalName: result.BasicData.LegalName,
      cnpj: result.BasicData.TaxIdNumber,
      phone: result.BasicData.Phone?.Number || '',
      address: {
        street: `${result.BasicData.Address?.Street || ''} ${
          result.BasicData.Address?.Number || ''
        }`.trim(),
        city: result.BasicData.Address?.City || '',
        state: result.BasicData.Address?.State || '',
        zipcode: result.BasicData.Address?.ZipCode || '',
        country: result.BasicData.Address?.Country || '',
        neighborhood: result.BasicData.Address?.Neighborhood || '',
      },
    };
  }
}
