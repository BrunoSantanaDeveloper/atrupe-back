import { HttpService } from '@nestjs/axios';
import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  InternalServerErrorException,
} from '@nestjs/common';
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
    const sanitizedCpf = cpf.replace(/[.-]/g, '');
    const body = {
      Datasets: 'basic_data',
      q: `doc{${sanitizedCpf}}`,
      Limit: 1,
    };

    try {
      const response$ = this.httpService
        .post<PeopleResponseApi>(`${this.baseUrl}/pessoas`, body, {
          timeout: this.timeout,
          headers: {
            AccessToken: this.config.get('plug.bigDataCorp.token'),
          },
        })
        .pipe(map((response) => this.mapPeopleResponse(response.data)));

      const result = await firstValueFrom(response$);

      if (!result) {
        throw new BadRequestException('CPF não encontrado na base de dados');
      }

      return result;
    } catch (error) {
      console.error(
        'Error in BigDataCorp people service:',
        error.message || error,
      );
      throw error;
    }
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

  private validateApiResponse(response: PeopleResponseApi): void {
    console.log('Validating API response...');

    // Verificar se há status de erro da API
    if (response.Status) {
      const status = response.Status as any;

      // Verificar erros de login/autenticação
      if (status.login) {
        const loginError = status.login[0];
        console.error('Login error:', loginError);
        if (loginError.Code === -111) {
          throw new UnauthorizedException('Token de acesso inválido');
        }
        // Lançar erro para qualquer código de erro de login
        if (loginError.Code !== 0) {
          throw new UnauthorizedException(
            `Erro de autenticação: ${loginError.Message}`,
          );
        }
      }

      // Verificar erros da API
      if (status.api) {
        const apiError = status.api[0];
        console.error('API error:', apiError);
        if (apiError.Code === -114) {
          throw new BadRequestException('Parâmetro de documento inválido');
        }
        // Lançar erro para qualquer código de erro da API
        if (apiError.Code !== 0) {
          throw new BadRequestException(`Erro na API: ${apiError.Message}`);
        }
      }

      // Verificar se o dataset retornou erro
      if (status.basic_data) {
        const dataError = status.basic_data[0];
        console.log('Dataset status:', dataError);
        if (dataError.Code !== 0) {
          throw new InternalServerErrorException(
            `Erro na consulta: ${dataError.Message}`,
          );
        }
      }
    }
  }

  private mapPeopleResponse(
    response: PeopleResponseApi,
  ): PeopleResponse | null {
    this.validateApiResponse(response);

    if (!response.Result || response.Result.length === 0) {
      console.warn('No results found in API response');
      console.log('Response structure:', {
        hasResult: !!response.Result,
        resultLength: response.Result?.length || 0,
        queryId: response.QueryId,
        status: response.Status,
      });
      return null;
    }

    const basicData = response.Result[0].BasicData;
    console.log('Mapping people data for CPF:', basicData.TaxIdNumber);

    // Extract RG data from AlternativeIdNumbers and ExtendedDocumentInformation
    let rg: string | undefined;
    let rgIssuingAgency: string | undefined;
    let rgIssuingState: string | undefined;

    if (basicData.AlternativeIdNumbers) {
      // Find RG in AlternativeIdNumbers (format: "RG - XX" where XX is state)
      const rgKey = Object.keys(basicData.AlternativeIdNumbers).find((key) =>
        key.startsWith('RG - '),
      );

      if (rgKey) {
        rg = basicData.AlternativeIdNumbers[rgKey];

        // Try to get issuing agency and state from ExtendedDocumentInformation
        if (
          basicData.ExtendedDocumentInformation &&
          basicData.ExtendedDocumentInformation[rgKey]
        ) {
          const docInfo = basicData.ExtendedDocumentInformation[rgKey];
          rgIssuingAgency = docInfo.DocumentIssuingAgency;
          rgIssuingState = docInfo.DocumentIssuingStateCode;
        }
      }
    }

    return {
      name: basicData.Name,
      cpf: basicData.TaxIdNumber,
      birthdate: basicData.BirthDate,
      motherName: basicData.MotherName,
      rg,
      rgIssuingAgency,
      rgIssuingState,
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
}
