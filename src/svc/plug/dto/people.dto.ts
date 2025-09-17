export interface PeopleResponse {
  name: string;
  cpf: string;
  birthdate: string;
  motherName: string;
  rg?: string;
  rgIssuingAgency?: string;
  rgIssuingState?: string;
  address: {
    street: string;
    city: string;
    state: string;
    zipcode: string;
    country: string;
    neighborhood: string;
  };
}
