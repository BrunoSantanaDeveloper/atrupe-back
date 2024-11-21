import { ZipCodeResponse } from './dto/zipcode.dto';
import { CompanyResponse } from './dto/company.dto';
import { BankResponse } from './dto/bank';
import { PeopleResponse } from './dto/people.dto';
import { StateResponse } from './dto/state';
import { CityResponse } from './dto/city';

export interface PlugInterface {
  zipcode(zipcode: string): Promise<ZipCodeResponse>;
  company(cnpj: string): Promise<CompanyResponse>;
  banks(): Promise<BankResponse[]>;
  bank(code: string): Promise<BankResponse>;
  people(cpf: string): Promise<PeopleResponse>;
  states(): Promise<StateResponse[]>;
  cities(state: string): Promise<CityResponse[]>;
}
