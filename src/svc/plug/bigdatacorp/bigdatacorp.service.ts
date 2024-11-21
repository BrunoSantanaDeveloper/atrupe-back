import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { PeopleResponse } from '../dto/people.dto';
import { PeopleResponseApi } from './dto/people.dto';
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
    const body = {
      Datasets: 'basic_data',
      q: `doc{${cpf}}`,
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

  async company(cnpj: string): Promise<any> {
    throw new Error('Method not implemented. Data: ' + cnpj);
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
    if (response.Result.length === 0) {
      return null;
    }
    return {
      name: response.Result[0].BasicData.Name,
      cpf: response.Result[0].BasicData.TaxIdNumber,
      birthdate: response.Result[0].BasicData.BirthDate,
      motherName: response.Result[0].BasicData.MotherName,
    };
  }
}
