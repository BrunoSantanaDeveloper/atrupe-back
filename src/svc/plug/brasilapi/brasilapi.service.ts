import { Injectable } from '@nestjs/common';
import { ZipCodeResponse } from '../dto/zipcode.dto';
import { HttpService } from '@nestjs/axios';
import { CepResponse } from './dto/cep.dto';
import { firstValueFrom, map } from 'rxjs';
import { CNPJResponse } from './dto/cnpj.dto';
import { CompanyResponse } from '../dto/company.dto';
import { BankResponse } from '../dto/bank';
import { StateResponse } from '../dto/state';
import { UfResponse } from './dto/uf.dto';
import { CityResponse } from '../dto/city';
import { CidadeResponse } from './dto/cidade.dto';

@Injectable()
export class BrasilApiService {
  private readonly baseUrl = 'https://brasilapi.com.br/api';
  private readonly timeout = 15000;
  private readonly retryAttempts = 3;

  constructor(private readonly httpService: HttpService) {}

  async zipcode(zipCode: string): Promise<ZipCodeResponse> {
    const response$ = this.httpService
      .get<CepResponse>(`${this.baseUrl}/cep/v1/${zipCode}`, {
        timeout: this.timeout,
      })
      .pipe(map((response) => this.mapCepResponse(response.data)));

    return await firstValueFrom(response$);
  }

  async company(cnpj: string): Promise<CompanyResponse> {
    const response$ = this.httpService
      .get<CNPJResponse>(`${this.baseUrl}/cnpj/v1/${cnpj}`, {
        timeout: this.timeout,
      })
      .pipe(map((response) => this.mapCnpjResponse(response.data)));

    return await firstValueFrom(response$);
  }

  async banks(): Promise<BankResponse[]> {
    const response$ = this.httpService
      .get<BankResponse[]>(`${this.baseUrl}/banks/v1`, {
        timeout: this.timeout,
      })
      .pipe(map((response) => response.data));

    return await firstValueFrom(response$);
  }

  async bank(code: string): Promise<BankResponse> {
    const response$ = this.httpService
      .get<BankResponse>(`${this.baseUrl}/banks/v1/${code}`, {
        timeout: this.timeout,
      })
      .pipe(map((response) => response.data));

    return await firstValueFrom(response$);
  }

  async states(): Promise<StateResponse[]> {
    const response$ = this.httpService
      .get<UfResponse[]>(`${this.baseUrl}/ibge/uf/v1`, {
        timeout: this.timeout,
      })
      .pipe(map((response) => this.mapStatesResponse(response.data)));

    return await firstValueFrom(response$);
  }

  async cities(state: string): Promise<CityResponse[]> {
    const response$ = this.httpService
      .get<CidadeResponse[]>(
        `${this.baseUrl}/ibge/municipios/v1/${state}?providers=dados-abertos-br,gov,wikipedia`,
        {
          timeout: this.timeout,
        },
      )
      .pipe(map((response) => this.mapCitiesResponse(response.data)));

    return await firstValueFrom(response$);
  }

  /***************************************************************************/
  // Not implemented methods
  /***************************************************************************/

  async people(cpf: string): Promise<any> {
    throw new Error('Method not implemented. Data: ' + cpf);
  }

  /***************************************************************************/
  // Private methods
  /***************************************************************************/

  private mapStatesResponse(response: UfResponse[]): StateResponse[] {
    return response.map((state) => {
      return {
        code: state.sigla,
        name: state.nome,
      };
    });
  }

  private mapCitiesResponse(response: CidadeResponse[]): CityResponse[] {
    return response.map((city) => {
      return {
        code: city.codigo_ibge,
        name: city.nome,
      };
    });
  }

  private mapCnpjResponse(response: CNPJResponse): CompanyResponse {
    return {
      name: response.nome_fantasia,
      legalName: response.razao_social,
      cnpj: response.cnpj,
      phone: response.ddd_telefone_1,
      address: {
        street:
          response.descricao_tipo_de_logradouro + ' ' + response.logradouro,
        city: response.municipio,
        state: response.uf,
        zipcode: String(response.cep),
        country: 'Brasil',
        neighborhood: response.bairro,
      },
    };
  }

  private mapCepResponse(response: CepResponse): ZipCodeResponse {
    return {
      zipCode: response.cep,
      state: response.state,
      city: response.city,
      neighborhood: response.neighborhood,
      street: response.street,
      country: 'Brasil',
      location: {
        latitude: response?.location?.coordinates?.latitude,
        longitude: response?.location?.coordinates?.longitude,
      },
    };
  }
}
