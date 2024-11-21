import { Injectable } from '@nestjs/common';
import { PluggedEnum } from './plugged.enum';
import { PlugInterface } from './plug.interface';
import { BrasilApiService } from './brasilapi/brasilapi.service';
import { ZipCodeResponse } from './dto/zipcode.dto';
import { CompanyResponse } from './dto/company.dto';
import { BigdatacorpService } from './bigdatacorp/bigdatacorp.service';
import { PeopleResponse } from './dto/people.dto';
import { StateResponse } from './dto/state';
import { CityResponse } from './dto/city';

/**
 * PlugService handles the connections with different systems.
 * It manages a map of different services (plugged) and allows for easy access to their functionality.
 */
@Injectable()
export class PlugService {
  // A map to store partners system instances, indexed by PluggedEnum
  private readonly plugged: Map<PluggedEnum, PlugInterface>;

  /**
   * Initializes the PlugService and sets up the service systems map.
   * @param brasilapi
   * @param bigdatacorp
   */
  constructor(
    private readonly brasilapi: BrasilApiService,
    private readonly bigdatacorp: BigdatacorpService,
  ) {
    this.plugged = new Map<PluggedEnum, PlugInterface>();
    this.plugged.set(PluggedEnum.BrasilApi, this.brasilapi);
    this.plugged.set(PluggedEnum.BigDataCorp, this.bigdatacorp);
  }

  async zipcode(zipcode: string): Promise<ZipCodeResponse> {
    const api = this.plugged.get(PluggedEnum.BrasilApi);

    try {
      return await api.zipcode(zipcode);
    } catch (e) {
      console.error(e);
      throw e;
    }
  }

  async company(cnpj: string): Promise<CompanyResponse> {
    const api = this.plugged.get(PluggedEnum.BrasilApi);
    try {
      return await api.company(cnpj);
    } catch (e) {
      console.error(e);
      throw e;
    }
  }

  async people(cpf: string): Promise<PeopleResponse> {
    const api = this.plugged.get(PluggedEnum.BigDataCorp);
    try {
      return await api.people(cpf);
    } catch (e) {
      console.error(e);
      throw e;
    }
  }

  async states(): Promise<StateResponse[]> {
    const api = this.plugged.get(PluggedEnum.BrasilApi);
    try {
      return await api.states();
    } catch (e) {
      console.error(e);
      throw e;
    }
  }

  async cities(state: string): Promise<CityResponse[]> {
    const api = this.plugged.get(PluggedEnum.BrasilApi);
    try {
      return await api.cities(state);
    } catch (e) {
      console.error(e);
      throw e;
    }
  }

  /***************************************************************************/
  // Not implemented methods
  /***************************************************************************/

  async banks() {
    throw new Error('Method not implemented.');
  }

  async bank(code: string) {
    throw new Error('Method not implemented. Data: ' + code);
  }
}
