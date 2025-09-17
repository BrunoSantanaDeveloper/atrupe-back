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
  private readonly useMockData = this.config.get('plug.bigDataCorp.mockData');

  constructor(
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
  ) {}

  async people(cpf: string): Promise<PeopleResponse> {
    if (this.useMockData) {
      return this.getMockPeopleData();
    }

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

  private getMockPeopleData(): PeopleResponse {
    const mockResponse: PeopleResponseApi = {
      Result: [
        {
          MatchKeys: 'doc{01234567890}',
          BasicData: {
            TaxIdNumber: '01234567890',
            TaxIdCountry: 'BRAZIL',
            AlternativeIdNumbers: {
              SocialSecurityNumber: '12461176258',
              'RG - GO': '0123456789',
            },
            ExtendedDocumentInformation: {
              'RG - GO': {
                DocumentNumber: '0123456789',
                DocumentLast4Digits: '6789',
                DocumentIssuingAgency: 'SSP',
                DocumentIssuingStateCode: 'GO',
                CreationDate: '2010-12-24T21:09:05.713Z',
                LastUpdateDate: '2010-12-24T21:09:05.713Z',
                Sources: ['MEI-RF'],
              },
            },
            Name: 'SEBASTIANA M. DE CARVALHO',
            Aliases: {
              CommonName: 'SEBASTIANA CARVALHO',
              StandardizedName: 'SEBASTIANA M CARVALHO',
            },
            Gender: 'F',
            NameWordCount: 4,
            NumberOfFullNameNamesakes: 2,
            NameUniquenessScore: 1,
            FirstNameUniquenessScore: 0.001,
            FirstAndLastNameUniquenessScore: 0.001,
            BirthDate: '1964-04-24T00:00:00Z',
            CapturedBirthDateFromRFSource: '1964-04-24',
            IsValidBirthDateInRFSource: true,
            Age: 61,
            ZodiacSign: 'TOURO',
            ChineseSign: 'Dragon',
            BirthCountry: 'BRASILEIRA',
            MotherName: 'MARIA JOSE DA SILVA VALORES',
            FatherName: '',
            MaritalStatusData: {},
            TaxIdStatus: 'SUSPENSA',
            TaxIdOrigin: 'RECEITA FEDERAL',
            TaxIdFiscalRegion: 'SP',
            HasObitIndication: false,
            TaxIdStatusDate: '2025-02-11T00:00:00Z',
            TaxIdStatusRegistrationDate: '1990-11-10T00:00:00Z',
            CreationDate: '2016-12-08T00:00:00Z',
            LastUpdateDate: '2025-09-03T00:00:00Z',
          },
        },
      ],
      QueryId: '9e9633e0-43bb-4b16-837a-ac7f55d2d368',
      ElapsedMilliseconds: 150,
      QueryDate: '2025-09-16T19:44:52.7534614Z',
      Status: {
        basic_data: [
          {
            Code: 0,
            Message: 'OK',
          },
        ],
      },
      Evidences: {},
    };

    return this.mapPeopleResponse(mockResponse);
  }

  private validateApiResponse(response: PeopleResponseApi): void {
    // Verificar se há status de erro da API
    if (response.Status) {
      const status = response.Status as any;

      // Verificar erros de login/autenticação
      if (status.login) {
        const loginError = status.login[0];
        if (loginError.Code === -111) {
          throw new UnauthorizedException('Token de acesso inválido');
        }
      }

      // Verificar erros da API
      if (status.api) {
        const apiError = status.api[0];
        if (apiError.Code === -114) {
          throw new BadRequestException('Parâmetro de documento inválido');
        }
      }

      // Verificar se o dataset retornou erro
      if (status.basic_data) {
        const dataError = status.basic_data[0];
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
      return null;
    }

    const basicData = response.Result[0].BasicData;

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
