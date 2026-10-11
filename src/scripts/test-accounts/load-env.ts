import { config } from 'dotenv';

// Primeiro import do script: a guarda lê o ambiente antes de a API subir, e
// o configuration.ts lê o ASAAS_* no import. No container não há .env (as
// variáveis vêm do env_file da stack) e isto não faz nada.
config({ quiet: true });
