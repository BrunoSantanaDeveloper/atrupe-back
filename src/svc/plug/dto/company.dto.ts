export interface CompanyResponse {
  name: string;
  legalName: string;
  cnpj: string;
  phone: string;
  address: {
    street: string;
    number?: string;
    complement?: string;
    city: string;
    state: string;
    zipcode: string;
    country: string;
    neighborhood: string;
  };
}
