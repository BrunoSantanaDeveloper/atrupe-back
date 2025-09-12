export interface CompanyResponseApi {
  Result: CompanyResult[];
  QueryId: string;
  ElapsedMilliseconds: number;
  QueryDate: string;
  Status: CompanyStatus;
  Evidences: CompanyEvidences;
}

export interface CompanyResult {
  MatchKeys: string;
  BasicData: CompanyBasicData;
}

export interface CompanyBasicData {
  TaxIdNumber: string;
  TaxIdCountry: string;
  Name: string;
  LegalName: string;
  TradeName: string;
  RegistrationNumber: string;
  RegistrationDate: string;
  RegistrationStatus: string;
  LegalNature: string;
  MainEconomicActivity: MainEconomicActivity;
  Address: CompanyAddress;
  Phone: CompanyPhone;
  Email: string;
  ShareCapital: number;
  CompanySize: string;
  CreationDate: string;
  LastUpdateDate: string;
}

export interface MainEconomicActivity {
  Code: string;
  Description: string;
}

export interface CompanyAddress {
  Street: string;
  Number: string;
  Complement: string;
  Neighborhood: string;
  City: string;
  State: string;
  ZipCode: string;
  Country: string;
}

export interface CompanyPhone {
  Number: string;
  Area: string;
}

export interface CompanyStatus {
  basic_data: CompanyBasicDaum[];
}

export interface CompanyBasicDaum {
  Code: number;
  Message: string;
}

export interface CompanyEvidences {}
