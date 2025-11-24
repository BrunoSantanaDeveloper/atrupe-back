# Histórico de Duplicação de Orçamento

## Status Atual

❌ **NÃO IMPLEMENTADO** - O registro de histórico na duplicação de orçamento ainda não está implementado.

## Problema Identificado

O método `duplicate()` em [quotation.service.ts](../core/sale/quotation/quotation.service.ts:1415) cria uma cópia completa de um orçamento, mas **não registra essa ação no histórico**.

### Linha do método:
```typescript
async duplicate(
  quotationId: string,
  duplicateDto: DuplicateQuotationDto,
): Promise<Quotation> {
  // ... código de duplicação ...
  return newQuotation; // ❌ Não há registro no histórico
}
```

## O que precisa ser implementado

### 1. Schema Prisma

✅ **JÁ ATUALIZADO** - Ação `DUPLICATED` adicionada ao comentário:

```prisma
model QuotationHistory {
  // ...
  action String // CREATED, FINISHED, REOPENED, REJECTED, VALUE_CHANGED, APPROVED, DUPLICATED
  // ...
}
```

### 2. Registro no Serviço

Quando o histórico for reimplementado nos serviços (atualmente foi removido para usar o sistema unificado), adicionar o seguinte **antes do return** no método `duplicate()`:

```typescript
// ===== ADICIONAR ANTES DO RETURN =====

// Registrar no histórico que o orçamento foi duplicado
try {
  await this.prisma.quotationHistory.create({
    data: {
      quotationId: newQuotation.id,
      action: 'DUPLICATED',
      description: `Orçamento duplicado a partir do orçamento #${quotation.quotationNumber}`,
      changes: null,
      metadata: {
        originalQuotationId: quotation.id,
        originalQuotationNumber: quotation.quotationNumber,
        updatedPrices: duplicateDto.updatePrices || false,
        clientChanged: duplicateDto.clientId !== quotation.clientId,
        contactChanged: duplicateDto.contactId !== quotation.contactId,
        descriptionChanged: duplicateDto.description !== quotation.description,
      },
      createdBy: userId, // ⚠️ userId precisa ser passado como parâmetro
      createdByName: null, // Será preenchido pela query com o nome do usuário
    },
  });
} catch (error) {
  console.error('Error creating quotation duplication history:', error);
  // Não lançar erro para não quebrar a operação principal
}

return newQuotation;
```

### 3. Atualizar assinatura do método

O método precisa receber o `userId` para registrar quem duplicou:

**Antes:**
```typescript
async duplicate(
  quotationId: string,
  duplicateDto: DuplicateQuotationDto,
): Promise<Quotation>
```

**Depois:**
```typescript
async duplicate(
  quotationId: string,
  duplicateDto: DuplicateQuotationDto,
  userId: string, // ⭐ ADICIONAR
): Promise<Quotation>
```

### 4. Atualizar Controller

O controller precisa passar o `userId` do usuário autenticado:

**Antes:**
```typescript
@Post(':id/duplicate')
async duplicate(
  @Param('id') id: string,
  @Body() duplicateDto: DuplicateQuotationDto,
) {
  return this.quotationService.duplicate(id, duplicateDto);
}
```

**Depois:**
```typescript
@Post(':id/duplicate')
async duplicate(
  @Param('id') id: string,
  @Body() duplicateDto: DuplicateQuotationDto,
  @Req() req: any, // ⭐ ADICIONAR
) {
  const userId = req.user?.sub || req.user?.id;
  return this.quotationService.duplicate(id, duplicateDto, userId);
}
```

## Informações Registradas no Histórico

### action
`DUPLICATED`

### description
`"Orçamento duplicado a partir do orçamento #123"`

### metadata
```json
{
  "originalQuotationId": "uuid",
  "originalQuotationNumber": 123,
  "updatedPrices": true,
  "clientChanged": false,
  "contactChanged": false,
  "descriptionChanged": true
}
```

### Campos importantes:
- `originalQuotationId`: ID do orçamento original
- `originalQuotationNumber`: Número do orçamento original
- `updatedPrices`: Se os preços foram atualizados na duplicação
- `clientChanged`: Se o cliente foi alterado
- `contactChanged`: Se o contato foi alterado
- `descriptionChanged`: Se a descrição foi modificada

## Como será exibido

### No Histórico do Orçamento Novo (duplicado)
```json
{
  "id": "uuid",
  "type": "quotation",
  "action": "DUPLICATED",
  "description": "Orçamento duplicado a partir do orçamento #123",
  "metadata": {
    "originalQuotationId": "uuid-original",
    "originalQuotationNumber": 123,
    "updatedPrices": true
  },
  "createdBy": "user-id",
  "createdByName": "João Silva",
  "createdAt": "2024-01-15T10:00:00.000Z"
}
```

### No Histórico do Colaborador
Aparecerá junto com todas as outras ações do usuário:
```
15/01/2024 10:00 - [QUOTATION] Orçamento duplicado a partir do orçamento #123
```

## Ordem de Serviço

❌ **Ordem de serviço NÃO possui funcionalidade de duplicação implementada**.

Se for necessário implementar duplicação de ordens no futuro:
1. Criar método `duplicate()` em [order.service.ts](../core/sale/order/order.service.ts)
2. Adicionar ação `DUPLICATED` ao comentário de `OrderHistory` no schema
3. Registrar no histórico seguindo o mesmo padrão

## Resumo

| Item | Status |
|------|--------|
| Schema atualizado com DUPLICATED | ✅ Feito |
| Método duplicate existe | ✅ Existe |
| Registro no histórico implementado | ❌ Pendente |
| userId passado como parâmetro | ❌ Pendente |
| Controller atualizado | ❌ Pendente |
| Ordem possui duplicação | ❌ Não existe |

## Próximos Passos

1. ✅ Documentação criada
2. ⏳ Aguardar reimplementação dos históricos nos serviços
3. ⏳ Implementar registro de duplicação seguindo este documento
4. ⏳ Decidir se ordens de serviço precisam de duplicação

## Referências

- [quotation.service.ts:1415](../core/sale/quotation/quotation.service.ts) - Método duplicate
- [historico-vendas-unificado.md](./historico-vendas-unificado.md) - Sistema de histórico unificado
- [historico-colaborador-completo.md](./historico-colaborador-completo.md) - Histórico de colaborador
