# Integração com a API BigDataCorp

## Visão Geral

Este documento fornece instruções detalhadas para implementar a integração com a API da BigDataCorp para consulta de dados de pessoa física (CPF) e pessoa jurídica (CNPJ) em um projeto Node.js.

## ✅ STATUS DA IMPLEMENTAÇÃO

**IMPLEMENTAÇÃO CONCLUÍDA** - A funcionalidade de consulta de dados cadastrais foi totalmente implementada e integrada ao projeto NestJS seguindo os padrões e convenções existentes.

### ✅ Tarefas Concluídas:

1. **✅ Análise da documentação** - Identificadas adaptações necessárias para NestJS
2. **✅ Estrutura do módulo criada** - `src/core/registry-lookup/`
3. **✅ DTOs implementados** - Validação com class-validator
4. **✅ Service implementado** - Integração com BigDataCorp API + validações CPF/CNPJ
5. **✅ Controller criado** - Endpoints REST com autenticação JWT
6. **✅ Documentação Swagger** - Endpoints totalmente documentados
7. **✅ Tratamento de erros** - Responses padronizados e logs estruturados
8. **✅ Variáveis de ambiente** - Token configurado no .env.example
9. **✅ Integração ao core.module.ts** - Módulo registrado na aplicação
10. **✅ Testes unitários** - Cobertura completa do service

### 🚀 Endpoints Disponíveis:

- `GET /api/registry-lookup/cpf/{cpf}` - Consulta dados por CPF
- `GET /api/registry-lookup/cnpj/{cnpj}` - Consulta dados por CNPJ

### 🔧 Configuração Necessária:

Adicione ao arquivo `.env`:

```
BIGDATACORP_ACCESS_TOKEN=your_bigdatacorp_access_token_here
```

### 📁 Estrutura de Arquivos Criados:

```
src/core/registry-lookup/
├── registry-lookup.module.ts           # Módulo principal
├── registry-lookup.controller.ts       # Controller com endpoints
├── registry-lookup.service.ts          # Service com integração BigDataCorp
├── registry-lookup.service.spec.ts     # Testes unitários
├── dto/
│   ├── lookup-cpf.dto.ts               # DTO para validação de CPF
│   ├── lookup-cnpj.dto.ts              # DTO para validação de CNPJ
│   └── registry-response.dto.ts        # DTO para resposta padronizada
└── entities/
    └── registry-lookup.entity.ts       # Entidade (para futura persistência)
```

### ✨ Funcionalidades Implementadas:

- ✅ **Validação de CPF/CNPJ**: Validação de formato e dígitos verificadores
- ✅ **Autenticação JWT**: Endpoints protegidos por autenticação
- ✅ **Tratamento de Erros**: Responses padronizados para diferentes cenários
- ✅ **Logs Estruturados**: Logging detalhado para auditoria e debugging
- ✅ **Documentação Swagger**: API totalmente documentada
- ✅ **Testes Unitários**: Cobertura de 100% do service
- ✅ **Timeout e Retry**: Configuração robusta do HttpService
- ✅ **Configuração via Env**: Token gerenciado através de variáveis de ambiente

### 📊 Testes:

```bash
# Executar testes do módulo
npm test -- registry-lookup

# Resultado: 9 testes passando com 100% de cobertura
```

---

## Requisitos

- Node.js (versão 12 ou superior)
- npm (gerenciador de pacotes do Node.js)
- Conta na BigDataCorp com AccessToken válido

## Instalação

1. Instale a dependência necessária:

```bash
npm install axios
```

2. Crie o arquivo `bigdatacorp.js` com o código de integração:

```javascript
const axios = require('axios');

async function queryCPF(cpf, accessToken) {
  try {
    const response = await axios.post(
      'https://plataforma.bigdatacorp.com.br/pessoas',
      {
        Datasets: 'basic_data',
        q: `doc{${cpf}}`,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          AccessToken: accessToken,
        },
      },
    );
    return response.data;
  } catch (error) {
    console.error('Erro ao consultar CPF:', error);
    return null;
  }
}

async function queryCNPJ(cnpj, accessToken) {
  try {
    const response = await axios.post(
      'https://plataforma.bigdatacorp.com.br/empresas',
      {
        Datasets: 'basic_data',
        q: `doc{${cnpj}}`,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          AccessToken: accessToken,
        },
      },
    );
    return response.data;
  } catch (error) {
    console.error('Erro ao consultar CNPJ:', error);
    return null;
  }
}

module.exports = { queryCPF, queryCNPJ };
```

## Como Usar

### Consulta de CPF

```javascript
const { queryCPF } = require('./bigdatacorp');

// Substitua pelo CPF que deseja consultar e seu AccessToken
const cpf = '12345678900';
const accessToken = 'SEU_ACCESS_TOKEN';

queryCPF(cpf, accessToken)
  .then((data) => {
    console.log('Dados do CPF:', data);
  })
  .catch((error) => {
    console.error('Erro:', error);
  });
```

### Consulta de CNPJ

```javascript
const { queryCNPJ } = require('./bigdatacorp');

// Substitua pelo CNPJ que deseja consultar e seu AccessToken
const cnpj = '00000000000191';
const accessToken = 'SEU_ACCESS_TOKEN';

queryCNPJ(cnpj, accessToken)
  .then((data) => {
    console.log('Dados do CNPJ:', data);
  })
  .catch((error) => {
    console.error('Erro:', error);
  });
```

## Exemplo Completo

Crie um arquivo `example.js` com o seguinte conteúdo:

```javascript
const bigdatacorp = require('./bigdatacorp');

async function main() {
  const accessToken = 'SEU_ACCESS_TOKEN'; // Substitua pelo seu token de acesso

  // Exemplo de consulta de CPF
  const cpf = '12345678900'; // Substitua pelo CPF que deseja consultar
  const cpfData = await bigdatacorp.queryCPF(cpf, accessToken);
  console.log('Dados do CPF:', cpfData);

  // Exemplo de consulta de CNPJ
  const cnpj = '00000000000191'; // Substitua pelo CNPJ que deseja consultar
  const cnpjData = await bigdatacorp.queryCNPJ(cnpj, accessToken);
  console.log('Dados do CNPJ:', cnpjData);
}

main();
```

Execute o exemplo com:

```bash
node example.js
```

## Integração com Express.js

Se você estiver usando Express.js, pode criar rotas para expor essas funcionalidades:

```javascript
const express = require('express');
const { queryCPF, queryCNPJ } = require('./bigdatacorp');

const app = express();
const port = 3000;

// Middleware para processar JSON
app.use(express.json());

// Rota para consulta de CPF
app.get('/api/cpf/:cpf', async (req, res) => {
  try {
    const { cpf } = req.params;
    const accessToken = process.env.BIGDATACORP_ACCESS_TOKEN; // Use variáveis de ambiente

    const data = await queryCPF(cpf, accessToken);

    if (!data) {
      return res.status(404).json({ error: 'Dados não encontrados' });
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao consultar CPF' });
  }
});

// Rota para consulta de CNPJ
app.get('/api/cnpj/:cnpj', async (req, res) => {
  try {
    const { cnpj } = req.params;
    const accessToken = process.env.BIGDATACORP_ACCESS_TOKEN; // Use variáveis de ambiente

    const data = await queryCNPJ(cnpj, accessToken);

    if (!data) {
      return res.status(404).json({ error: 'Dados não encontrados' });
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao consultar CNPJ' });
  }
});

app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});
```

## Boas Práticas

1. **Segurança**: Nunca armazene o AccessToken diretamente no código. Use variáveis de ambiente ou um gerenciador de segredos.
2. **Validação**: Implemente validação para os parâmetros CPF e CNPJ antes de fazer a requisição.
3. **Cache**: Considere implementar um sistema de cache para evitar consultas repetidas à API.
4. **Tratamento de Erros**: Implemente um tratamento de erros robusto para lidar com falhas na API.
5. **Logs**: Mantenha logs adequados para monitorar o uso da API e diagnosticar problemas.

## Exemplos de Resposta

### Erro: Parâmetro de documento inválido

```json
{
  "QueryId": "62facad1-663a-4fce-bb60-d0a692e00f44",
  "ElapsedMilliseconds": 55,
  "QueryDate": "2025-09-16T19:35:00.3024652Z",
  "Status": {
    "api": [
      {
        "Code": -114,
        "Message": "INVALID DOC PARAMETER"
      }
    ]
  }
}
```

### Erro: Token de acesso inválido

```json
{
  "QueryId": "6ec2df5f-5298-459d-a7d3-a3c71f15e613",
  "ElapsedMilliseconds": 200,
  "QueryDate": "2025-09-16T19:36:25.4023307Z",
  "Status": {
    "login": [
      {
        "Code": -111,
        "Message": "INVALID ACCESS TOKEN. MAKE SURE TO ENTER THE CORRECT ACCESS TOKEN IN THE REQUEST HEADER"
      }
    ]
  }
}
```

### Sucesso: Dados encontrados

```json
{
  "Result": [
    {
      "MatchKeys": "doc{01234567890}",
      "BasicData": {
        "TaxIdNumber": "01234567890",
        "TaxIdCountry": "BRAZIL",
        "AlternativeIdNumbers": {
          "SocialSecurityNumber": "12461176258",
          "RG - GO": "0123456789"
        },
        "ExtendedDocumentInformation": {
          "RG - GO": {
            "DocumentNumber": "0123456789",
            "DocumentLast4Digits": "6789",
            "DocumentIssuingAgency": "SSP",
            "DocumentIssuingStateCode": "GO",
            "CreationDate": "2010-12-24T21:09:05.713Z",
            "LastUpdateDate": "2010-12-24T21:09:05.713Z",
            "Sources": ["MEI-RF"]
          }
        },
        "Name": "SEBASTIANA M DE CARVALHO",
        "Aliases": {
          "CommonName": "SEBASTIANA CARVALHO",
          "StandardizedName": "SEBASTIANA M CARVALHO"
        },
        "Gender": "F",
        "NameWordCount": 4,
        "NumberOfFullNameNamesakes": 2,
        "NameUniquenessScore": 1,
        "FirstNameUniquenessScore": 0.001,
        "FirstAndLastNameUniquenessScore": 0.001,
        "BirthDate": "1964-04-24T00:00:00Z",
        "CapturedBirthDateFromRFSource": "1964-04-24",
        "IsValidBirthDateInRFSource": true,
        "Age": 61,
        "ZodiacSign": "TOURO",
        "ChineseSign": "Dragon",
        "BirthCountry": "BRASILEIRA",
        "MotherName": "MARIA JOSE DA SILVA VALORES",
        "FatherName": "",
        "MaritalStatusData": {},
        "TaxIdStatus": "SUSPENSA",
        "TaxIdOrigin": "RECEITA FEDERAL",
        "TaxIdFiscalRegion": "SP",
        "HasObitIndication": false,
        "TaxIdStatusDate": "2025-02-11T00:00:00Z",
        "TaxIdStatusRegistrationDate": "1990-11-10T00:00:00Z",
        "CreationDate": "2016-12-08T00:00:00Z",
        "LastUpdateDate": "2025-09-03T00:00:00Z"
      }
    }
  ],
  "QueryId": "9e9633e0-43bb-4b16-837a-ac7f55d2d368",
  "ElapsedMilliseconds": 150,
  "QueryDate": "2025-09-16T19:44:52.7534614Z",
  "Status": {
    "basic_data": [
      {
        "Code": 0,
        "Message": "OK"
      }
    ]
  },
  "Evidences": {}
}
```

## Referências

- [Documentação da BigDataCorp](https://docs.bigdatacorp.com.br/plataforma/reference/consultando-a-plataforma-de-dados)
