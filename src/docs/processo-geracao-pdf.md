# Processo de Geração de PDF - Orçamentos, Ordens de Produção e Fichas de Produção

## Visão Geral

Este documento documenta o processo de geração de PDFs no sistema Atrupe API, incluindo orçamentos, ordens de produção e fichas de produção.

## Arquitetura de PDF

### Serviço Principal de PDF

**Arquivo:** `src/svc/pdf/pdf.service.ts`

O sistema utiliza o **jsPDF** como biblioteca principal para geração de PDFs.

#### Estrutura do PdfService

```typescript
interface PdfStructure {
  header: string;
  body: string;
  footer: string;
}

@Injectable()
export class PdfService {
  async generate(data: PdfStructure)
}
```

**Características:**
- Utiliza formato A4 (portrait)
- Footer padrão da empresa Atrupe Sistemas
- Suporte básico para cabeçalho, corpo e rodapé
- Retorna Buffer do PDF gerado

## 1. Geração de PDF de Orçamentos

### Endpoint Principal
- **Rota:** `GET /sale/quotation/:id/pdf-data`
- **Controller:** `quotation.controller.ts:509`
- **Service:** `quotation.service.ts:1721`

### Processo de Geração

#### 1.1 Coleta de Dados
O método `getQuotationPdfData(id: string)` coleta dados completos do orçamento:

```typescript
// Principais dados coletados:
- Informações da empresa (nome, CNPJ, endereço, logo, redes sociais)
- Dados do cliente (nome, documento, telefone, email, endereço)
- Informações do contato
- Detalhes do orçamento (número, série, descrição, vendedor, datas, status)
- Informações da ordem de produção (se aprovado)
- Itens do orçamento com composições detalhadas
- Informações de entrega (fornecedor, prazo, custos)
- Condições de pagamento e parcelas
- Totais (subtotal, desconto, total final)
```

#### 1.2 Estrutura dos Dados Retornados

**Dados da Empresa:**
- Nome, CNPJ, email, site
- Endereço completo
- Logo e textos personalizados
- Redes sociais

**Dados do Cliente:**
- Informações pessoais/empresariais
- Endereço principal
- Contatos

**Itens do Orçamento:**
- Descrição e imagem do produto
- Composições detalhadas (nome, quantidade, unidade, valores)
- Descontos aplicados
- Valores unitários e totais

**Condições Comerciais:**
- Forma e condições de pagamento
- Parcelas detalhadas
- **Formas de pagamento disponíveis** (novo)
- Informações de entrega
- Comissões (se aplicável)

### 1.3 Localização dos Dados
- **Linha 1721-2054:** Método `getQuotationPdfData`
- **Linha 2056-2178:** Método `getAvailablePaymentMethods` (novo)
- **Includes complexos:** Company, Client, Seller, Products, Items, Payment, Delivery

#### 1.4 Nova Funcionalidade: Formas de Pagamento Disponíveis

**Implementação:** `quotation.service.ts:2056`

A nova propriedade `availablePaymentMethods` foi adicionada ao objeto `payment` na resposta da API, conforme solicitação do frontend.

**Funcionalidades:**
- **Busca métodos de pagamento ativos** da empresa configurados para recebíveis
- **Filtragem por cliente:** Se o orçamento possui cliente, aplica filtros específicos baseados nas condições de pagamento do cliente
- **Formatação user-friendly:** Inclui informações de limite de parcelas (ex: "Cartão de crédito até 3x")
- **Fallback seguro:** Retorna array vazio em caso de erro, não quebra o PDF

**Estrutura da Resposta:**
```typescript
{
  payment: {
    condition: string
    method: string
    totalInstallments: number
    installments: InstallmentType[]
    availablePaymentMethods: string[] // NOVA PROPRIEDADE
  }
}
```

**Exemplo de Resposta:**
```json
{
  "payment": {
    "condition": "30 dias",
    "method": "PIX",
    "totalInstallments": 1,
    "installments": [...],
    "availablePaymentMethods": [
      "PIX",
      "Cartão de débito", 
      "Cartão de crédito até 3x",
      "Boleto bancário",
      "Transferência bancária"
    ]
  }
}
```

**Lógica de Filtragem (Regra de Negócio Final):**
1. **Se tem cliente específico:**
   - Verifica se cliente possui condições específicas no cadastro (`ClientPaymentCondition`)
   - **Se SIM:** Retorna apenas as condições habilitadas para o cliente
   - **Se NÃO:** Retorna array vazio (não mostra nenhuma forma de pagamento)
2. **Se não tem cliente:** Retorna array vazio
3. **Formatação inteligente:**
   - Analisa condições de pagamento para extrair limite de parcelas
   - Formata nomes descritivos (ex: "Cartão de crédito até 3x")
   - Ordena por nome

**Uso no Frontend:**
- **`showPaymentDelivery = true`:** Exibe condições específicas do orçamento
- **`showPaymentDelivery = false`:** Exibe texto genérico com todas as formas disponíveis

## 2. Ordens de Produção (Production Orders)

### Processo de Criação de Ordens

#### 2.1 Aprovação de Orçamentos
**Método:** `quotation.service.ts:1311` - `approve(quotationId: string)`

**Processo:**
1. Valida se o orçamento existe
2. Verifica tipo de plano da empresa (trial vs. subscription)
3. Cria a ordem de produção
4. Gera agendamento de entrega
5. Cria etapas de produção automaticamente
6. Executa faturamento se configurado

#### 2.2 Criação de Etapas de Produção
**Método:** `createProductionStages(quotationId: string, isTrial: boolean)`

**Processo:**
1. Busca produtos do orçamento que possuem etapas de produção
2. Extrai etapas ativas dos produtos
3. Remove duplicatas mantendo ordem
4. Adiciona etapas do sistema baseadas no tipo de entrega:
   - **CARRIER:** Adiciona etapa "Entrega"
   - **PICKUP:** Adiciona etapa "Cliente Retira"
5. Cria registros na tabela `ProductionStage`

#### 2.3 Gerenciamento de Etapas
**Service:** `production-stage.service.ts`

**Funcionalidades:**
- Atualização de status das etapas
- Controle de status anterior (`prevStatus`)
- Atualização automática do status de entrega quando todas etapas estão concluídas
- Status possíveis: `PENDING`, `IN_PROGRESS`, `DONE`, `CANCELED`

### 2.4 Dados da Ordem de Produção
**Fonte:** `order.service.ts:238` - `findOne(id: string)`

**Dados Coletados:**
- Informações da ordem (ID, status, datas)
- Dados completos do orçamento relacionado
- Informações de entrega e agendamento
- Produtos e composições para produção
- Status financeiro (faturado/pendente)
- Dados do cliente e empresa

## 3. Fichas de Produção (Production Sheets)

### 3.1 Conceito
As fichas de produção são baseadas no sistema de **etapas de produção** (Production Stages) e **agendamento de entrega** (Delivery Schedule).

### 3.2 Estrutura das Etapas
**Dados Disponíveis:**
- ID da etapa
- Status atual e anterior
- Ordem de execução
- Notas da etapa
- Informações do setor responsável (nome, ícone)
- Referência ao agendamento de entrega

### 3.3 Agendamento de Entrega
**Service:** `delivery-schedule.service.ts`

**Dados da Ficha de Produção:**
- Status da entrega (`IN_PRODUCTION`, `DELIVERING`, `FINISHED`, `DONE`)
- Data de agendamento
- Informações do pedido e orçamento
- Lista de etapas de produção com status
- Dados financeiros (se faturado)
- Informações do cliente

### 3.4 Controle de Produção
**Método:** `updateStatusIfAllStagesAreDone(scheduleId: string)`

**Lógica:**
1. Verifica se todas as etapas de produção estão concluídas
2. Atualiza status da entrega para `DELIVERING` quando produção finalizada
3. Diferencia etapas de produção das etapas de entrega
4. Controla transição automática entre status

## 4. Observações Técnicas

### 4.1 Limitações Atuais
- **PDF Service Básico:** Implementação simples com jsPDF, sem templates elaborados
- **Sem Geração Direta:** Dados são fornecidos via API, PDF gerado no frontend
- **Estrutura Padronizada:** Mesmo padrão de dados para diferentes tipos de documento

### 4.2 Padrões de Dados
- **Valores Monetários:** Armazenados em centavos (multiplicar por 100)
- **Datas:** Formato ISO com timezone
- **Status:** Enums bem definidos para cada tipo de documento
- **Relacionamentos:** Uso extensivo de includes do Prisma

### 4.3 Considerações de Performance
- **Transações:** Uso de transações do Prisma para operações complexas
- **Timeouts:** Configurados para 15 segundos em operações longas
- **Includes Otimizados:** Seleção específica de campos necessários

### 4.4 Integrações
- **Sistema Financeiro:** Geração automática de recebíveis e pagáveis
- **Gestão de Estoque:** Controle de produtos e composições
- **CRM:** Integração com dados de clientes e vendedores

## 5. Fluxo Completo do Processo

### 5.1 Fluxo do Orçamento ao PDF
```
1. Criação do Orçamento → quotation.service.ts:create()
2. Adição de Produtos → addProductToQuotation()
3. Configuração de Pagamento e Entrega
4. Finalização → finish()
5. Geração de Dados PDF → getQuotationPdfData()
6. Renderização PDF (Frontend)
```

### 5.2 Fluxo da Ordem de Produção
```
1. Aprovação do Orçamento → approve()
2. Criação da Ordem → order.service.ts:create()
3. Geração de Etapas → createProductionStages()
4. Agendamento de Entrega → DeliverySchedule.create()
5. Controle de Produção → ProductionStage.update()
6. Finalização → finishDeliverySchedule()
```

### 5.3 Fluxo da Ficha de Produção
```
1. Consulta de Agendamentos → delivery-schedule.service.ts:findAll()
2. Dados das Etapas → productionStages incluídas
3. Status da Produção → calculado automaticamente
4. Atualização de Etapas → production-stage.service.ts:update()
5. Geração da Ficha (dados via API)
```

## 6. Atualizações Recentes

### 6.1 Implementação de Formas de Pagamento Disponíveis (2025-08-05)

**Solicitação do Frontend:** Adicionar lista de formas de pagamento disponíveis para uso em modo de exibição genérica no PDF.

**Implementação Realizada:**

1. **Novo método privado:** `getAvailablePaymentMethods(companyId: string, clientId?: string)`
   - Busca métodos de pagamento ativos da empresa
   - Aplica filtros baseados no perfil do cliente
   - Formata nomes com informações de parcelas
   - Retorna array de strings user-friendly

2. **Atualização do endpoint:** `GET /sale/quotation/:id/pdf-data`
   - Nova propriedade `availablePaymentMethods` no objeto `payment`
   - Execução assíncrona durante coleta de dados do PDF
   - Fallback seguro em caso de erro

3. **Benefícios:**
   - **Frontend pode exibir texto genérico** quando `showPaymentDelivery = false`
   - **Informações específicas do cliente** quando aplicável
   - **Formatação consistente** com limite de parcelas
   - **Performance otimizada** com queries específicas

**Arquivo Modificado:** `src/core/sale/quotation/quotation.service.ts`
- **Linhas adicionadas:** 2056-2240 (método `getAvailablePaymentMethods`)
- **Linhas modificadas:** 2037-2040 (chamada no `getQuotationPdfData`)

### 6.2 Correção da Regra de Negócio (2025-08-05)

**Problema Identificado:** A implementação estava considerando fallbacks desnecessários.

**Regra de Negócio Correta Implementada:**
- **APENAS condições específicas do cliente** devem aparecer no PDF
- Se o cliente não tiver condições configuradas, **não mostra nenhuma forma de pagamento**
- Não usa configurações padrão da empresa ou limite de crédito como fallback

**Comportamento Final:**
1. **Cliente com condições específicas:** Mostra apenas as formas habilitadas para ele
2. **Cliente sem condições:** Array vazio (não mostra formas de pagamento)
3. **Orçamento sem cliente:** Array vazio

---

**Gerado automaticamente pela análise do código-fonte em:** `2025-08-05`
**Atualizado com nova implementação em:** `2025-08-05`