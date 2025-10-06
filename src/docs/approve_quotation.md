# Rota: POST /sale/quotation/:id/approve

## Descrição
Aprova um orçamento e cria automaticamente um pedido (order) associado, além de configurar toda a logística de entrega, transações financeiras (receivables/payables) e etapas de produção.

## Endpoint
`POST /sale/quotation/:id/approve`

## Autenticação
- Requer autenticação JWT (`JwtAuthGuard`)
- Bearer Token necessário

## Parâmetros

### Path Parameters
- `id` (string, obrigatório): UUID v4 do orçamento a ser aprovado

## Validações

### Controller ([quotation.controller.ts:194-210](src/core/sale/quotation/quotation.controller.ts#L194))
1. Valida se o `id` é um UUID v4 válido
2. Retorna `BadRequestException` com mensagem "Invalid id" se inválido

### Service ([quotation.service.ts:1444-1636](src/core/sale/quotation/quotation.service.ts#L1444))
1. Verifica se o orçamento existe
2. Retorna `NotFoundException` se não encontrado
3. Valida se existem informações de entrega (`deliveryInfo`)
4. Retorna `Error` se informações de entrega estiverem ausentes

## Fluxo de Execução

### 1. Verificação Inicial
- Busca o orçamento para obter o `companyId`
- Se não encontrado, lança `NotFoundException`

### 2. Verificação de Trial/Plano ([quotation.service.ts:1458-1495](src/core/sale/quotation/quotation.service.ts#L1458))
Verifica se a empresa está em período trial ou plano START:

```typescript
const subscription = companyData.Subscription?.[0];
isTrial = true se:
  - planType === 'TRIAL' E nextDueDate > data atual
  - OU planType === 'START'
```

### 3. Transação Principal ([quotation.service.ts:1497-1625](src/core/sale/quotation/quotation.service.ts#L1497))
Executa uma transação com timeout de 20 segundos (incluindo criação de receivables e payables):

#### 3.1. Atualizar Orçamento
```typescript
- status: QuotationStatus.APPROVED
- approvedAt: new Date()
```

Inclui no retorno dados completos:
- `deliveryInfo` (id, estimatedDate, daysAfterApproval, cost, supplierId, deliveryType)
- `quotationPayment` (billing, quotationInstallment, commission, downPayment, etc.)
- `quotationProduct` (com products e items)
- `client`, `series`

#### 3.2. Criar ou Buscar Pedido (Order)
- Verifica se já existe um pedido para este orçamento
- Se não existir, cria um novo pedido vinculado ao orçamento

#### 3.3. Calcular Data Estimada de Entrega
```typescript
estimatedDate = quotation.approvedAt + daysAfterApproval
// Usa add() do date-fns
```

#### 3.4. Atualizar DeliveryInfo
- Atualiza `estimatedDate` com a data calculada

#### 3.5. Criar DeliverySchedule
Cria agendamento de entrega com:
```typescript
{
  companyId: quotation.companyId,
  quotationId: quotation.id,
  orderId: order.id,
  deliveryInfoId: quotation.deliveryInfo.id,
  scheduledDate: estimatedDate,
  status: isTrial ? 'DELIVERING' : 'IN_PRODUCTION'
}
```

**Status baseado no tipo de plano:**
- `DELIVERING`: se empresa está em trial ou plano START
- `IN_PRODUCTION`: para empresas com planos regulares

#### 3.6. Criar Receivables e Payables (DENTRO DA TRANSAÇÃO)
**Condições para criação:**
- Não existem receivables/payables para este orçamento (evita duplicação)
- `billing === 'ON_ORDER'`

**Receivables criados ([quotation.service.ts:2952-3062](src/core/sale/quotation/quotation.service.ts#L2952)):**
1. **Receivable de Entrada** (se `downPayment > 0`)
   - `financialType: 'DOWN_PAYMENT'`
   - 1 installment com vencimento em `downPaymentDueDate`

2. **Receivable Principal** (se `billing !== 'NO_INVOICE'`)
   - `financialType: 'MAIN'`
   - N installments baseadas em `quotationInstallment`

**Payables criados ([quotation.service.ts:3064-3091](src/core/sale/quotation/quotation.service.ts#L3064)):**
1. **Payable de Comissão** (condicional - [quotation.service.ts:3141-3213](src/core/sale/quotation/quotation.service.ts#L3141))
   - Validações:
     - `commissionValue > 0` e `totalCommission > 0`
     - `supplierId` existe
   - `financialType: 'COMMISSION'`
   - Se `transferMethod === 'SINGLE'`: 1 parcela em 30 dias
   - Se `transferMethod === 'PAYMENT_BASED'`: mesmas parcelas do receivable

2. **Payable de Entrega** (condicional - [quotation.service.ts:3215-3259](src/core/sale/quotation/quotation.service.ts#L3215))
   - Validação: `delivery.cost > 0`
   - `financialType: 'DELIVERY'`
   - 1 parcela em 30 dias

### 4. Pós-Transação ([quotation.service.ts:1627-1635](src/core/sale/quotation/quotation.service.ts#L1627))

#### 4.1. Criar Etapas de Produção
Executa `createProductionStages(quotationId, isTrial)` FORA da transação

### 5. Criação de Etapas de Produção ([quotation.service.ts:1639-1755](src/core/sale/quotation/quotation.service.ts#L1639))

#### 5.1. Buscar Produtos do Orçamento
- Obtém todos os produtos (`quotationProduct`)
- Busca etapas de produção configuradas nos produtos

#### 5.2. Construir Etapas Únicas
```typescript
1. Extrai todas as etapas de todos os produtos
2. Filtra apenas etapas ativas (isActive: true)
3. Remove duplicatas mantendo a ordem
4. Mapeia para criar ProductionStage com:
   - stageId
   - order (sequencial, começando em 1)
   - prevStatus: null
   - scheduleId
```

#### 5.3. Adicionar Etapas do Sistema

**Se deliveryType === 'CARRIER':**
- Busca setor do sistema "Entrega" (isSystem: true)
- Adiciona no final do array de etapas

**Se deliveryType === 'PICKUP':**
- Busca setor do sistema "Cliente Retira" (isSystem: true)
- Adiciona no final do array de etapas

#### 5.4. Criar Etapas no Banco
- Se houver etapas, executa `createMany` para inserir todas de uma vez

## Resposta

### Sucesso (200)
Retorna o objeto `Order` criado:
```typescript
{
  id: string,
  quotationId: string,
  createdAt: Date,
  // ... outros campos do pedido
}
```

### Erros

#### 400 - Bad Request
```json
{
  "statusCode": 400,
  "message": "Invalid id"
}
```

#### 404 - Not Found
```json
{
  "statusCode": 404,
  "message": "Quotation with ID '{id}' not found."
}
```

#### 500 - Internal Server Error
```json
{
  "message": "Informações de entrega ausentes na venda."
}
```

## Efeitos Colaterais

### Banco de Dados (Tudo em uma única transação)
1. **Quotation**: atualizado com status APPROVED e approvedAt
2. **Order**: criado (se não existir)
3. **DeliveryInfo**: estimatedDate atualizado
4. **DeliverySchedule**: novo registro criado
5. **Receivable**: 1-2 registros (entrada + principal) se `billing === 'ON_ORDER'`
6. **ReceivableInstallment**: múltiplos registros conforme parcelas
7. **Payable**: 0-2 registros (comissão + entrega) se validações passarem
8. **PayableInstallment**: múltiplos registros conforme configuração
9. **ProductionStage**: múltiplos registros (FORA da transação)

### Serviços Externos
- Nenhum serviço externo é chamado diretamente

## Dependências

### Services
- `QuotationService` (único service - lógica financeira agora integrada)

### Bibliotecas
- `date-fns` (função `add` para cálculo de datas)
- `@nestjs/common` (exceções e decorators)
- `@prisma/client` (enums como QuotationStatus)

## Observações Importantes

1. **Timeout**: A transação tem timeout de 20 segundos (aumentado devido à criação de financials)
2. **Idempotência**: Verifica se pedido e financials já existem antes de criar
3. **Transação Única**: Receivables e Payables agora são criados DENTRO da transação principal para garantir consistência
4. **Verificação de Trial**: O status de trial impacta o status inicial da entrega (DELIVERING vs IN_PRODUCTION)
5. **Error Handling**: Erros na criação de etapas são capturados e logados, mas não bloqueiam a aprovação
6. **Atomicidade**: Se qualquer operação dentro da transação falhar, tudo é revertido (rollback)

## Mudanças Recentes

### Refatoração: Criação de Financials Movida para QuotationService
**Antes:**
- Financials eram criados pelo `DeliveryScheduleService.bill()` FORA da transação
- Chamada assíncrona após criação do pedido
- Risco de inconsistência se a criação de financials falhasse

**Depois:**
- Financials são criados no próprio `QuotationService` DENTRO da transação principal
- Métodos privados adicionados: `generateReceivableFromQuotation`, `generatePayableFromQuotation`, `shouldCreateCommissionPayable`, etc.
- Melhor coesão: toda lógica de aprovação em um único lugar
- Garantia de atomicidade: ou tudo é criado ou nada é criado
