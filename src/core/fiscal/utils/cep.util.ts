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
  // Remove non-numeric characters
  const cleanCep = cep.replace(/\D/g, '');

  if (cleanCep.length !== 8) {
    return null;
  }

  // Retry up to 3 times with increasing timeout
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const timeoutMs = 10000 + (attempt - 1) * 5000; // 10s, 15s, 20s
      const response = await axios.get<ViaCepResponse>(
        `https://viacep.com.br/ws/${cleanCep}/json/`,
        { timeout: timeoutMs },
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
      if (attempt === maxRetries) {
        console.error(
          `Error fetching CEP data after ${maxRetries} attempts:`,
          error.message,
        );
        return null;
      }
      console.warn(`CEP lookup attempt ${attempt} failed, retrying...`);
    }
  }

  return null;
}
