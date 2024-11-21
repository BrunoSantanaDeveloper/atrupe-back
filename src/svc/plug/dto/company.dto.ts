export interface CompanyResponse {
  name: string;
  legalName: string;
  cnpj: string;
  phone: string;
  address: {
    street: string;
    city: string;
    state: string;
    zipcode: string;
    country: string;
    neighborhood: string;
  };
}
