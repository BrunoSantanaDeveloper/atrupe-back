export interface PeopleResponse {
  name: string;
  cpf: string;
  birthdate: string;
  motherName: string;
  address: {
    street: string;
    city: string;
    state: string;
    zipcode: string;
    country: string;
    neighborhood: string;
  };
}
