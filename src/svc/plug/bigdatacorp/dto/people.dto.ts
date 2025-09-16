export interface PeopleResponseApi {
  Result: Result[];
  QueryId: string;
  ElapsedMilliseconds: number;
  QueryDate: string;
  Status: Status;
  Evidences: Evidences;
}

export interface Result {
  MatchKeys: string;
  BasicData: BasicData;
}

export interface BasicData {
  TaxIdNumber: string;
  TaxIdCountry: string;
  AlternativeIdNumbers: AlternativeIdNumbers;
  ExtendedDocumentInformation?: ExtendedDocumentInformation;
  Name: string;
  Aliases: Aliases;
  Gender: string;
  NameWordCount: number;
  NumberOfFullNameNamesakes: number;
  NameUniquenessScore: number;
  FirstNameUniquenessScore: number;
  FirstAndLastNameUniquenessScore: number;
  BirthDate: string;
  CapturedBirthDateFromRFSource?: string;
  IsValidBirthDateInRFSource?: boolean;
  Age: number;
  ZodiacSign: string;
  ChineseSign: string;
  BirthCountry: string;
  MotherName: string;
  FatherName: string;
  MaritalStatusData: MaritalStatusData;
  TaxIdStatus: string;
  TaxIdOrigin: string;
  TaxIdFiscalRegion: string;
  HasObitIndication: boolean;
  TaxIdStatusDate: string;
  TaxIdStatusRegistrationDate: string;
  CreationDate: string;
  LastUpdateDate: string;
}

export interface AlternativeIdNumbers {
  SocialSecurityNumber: string;
  [key: string]: string;
}

export interface Aliases {
  CommonName: string;
  StandardizedName: string;
}

export interface MaritalStatusData {}

export interface Status {
  basic_data?: BasicDaum[];
  login?: BasicDaum[];
  api?: BasicDaum[];
}

export interface BasicDaum {
  Code: number;
  Message: string;
}

export interface ExtendedDocumentInformation {
  [key: string]: DocumentInfo;
}

export interface DocumentInfo {
  DocumentNumber: string;
  DocumentLast4Digits: string;
  DocumentIssuingAgency: string;
  DocumentIssuingStateCode: string;
  CreationDate: string;
  LastUpdateDate: string;
  Sources: string[];
}

export interface Evidences {}
