import axios from 'axios';

interface ViaCepResponse {
  cep: string;
  logradouro: string;
  complemento: string;
  bairro: string;
  localidade: string;
  uf: string;
  ibge: string;
  gia: string;
  ddd: string;
  siafi: string;
  erro?: boolean;
}

export interface CepData {
  cep: string;
  logradouro: string;
  bairro: string;
  cidade: string;
  uf: string;
  codigoIbge: string;
}

/**
 * Fetches address data from CEP using ViaCEP API
 * @param cep CEP to lookup (with or without formatting)
 * @returns Address data including IBGE code, or null if not found
 */
export async function fetchCepData(cep: string): Promise<CepData | null> {
  try {
    // Remove non-numeric characters
    const cleanCep = cep.replace(/\D/g, '');

    if (cleanCep.length !== 8) {
      return null;
    }

    const response = await axios.get<ViaCepResponse>(
      `https://viacep.com.br/ws/${cleanCep}/json/`,
      { timeout: 5000 },
    );

    if (response.data.erro) {
      return null;
    }

    return {
      cep: response.data.cep,
      logradouro: response.data.logradouro,
      bairro: response.data.bairro,
      cidade: response.data.localidade,
      uf: response.data.uf,
      codigoIbge: response.data.ibge,
    };
  } catch (error) {
    console.error('Error fetching CEP data:', error.message);
    return null;
  }
}
