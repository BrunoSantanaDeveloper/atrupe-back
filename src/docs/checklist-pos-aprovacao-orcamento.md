# Checklist: Fluxo Pós-Aprovação de Orçamento

## Visão Geral
Este documento detalha todos os processos que são executados automaticamente após um orçamento ser aprovado no sistema. O fluxo envolve criação de ordem de serviço, gestão de entregas, geração de cronograma de produção e criação de registros financeiros.

---

## ✅ 1. CRIAÇÃO DA ORDEM DE SERVIÇO

### O que acontece:
- **Status do orçamento** é alterado para `APPROVED`
- **Data de aprovação** (`approvedAt`) é definida para data/hora atual
- **Ordem de serviço** é criada automaticamente com:
  - Status inicial: `PENDING`
  - Vinculação ao orçamento aprovado
  - Herança de todos os dados do orçamento

### Verificações necessárias:
- [ ] Orçamento possui status `APPROVED`
- [ ] Campo `approvedAt` foi preenchido
- [ ] Ordem de serviço foi criada
- [ ] Ordem possui status `PENDING`
- [ ] Vinculação entre ordem e orçamento está correta

---

## ✅ 2. CONFIGURAÇÃO DE ENTREGA

### O que acontece:
- **Cronograma de entrega** (`DeliverySchedule`) é criado
- **Data estimada de entrega** é calculada baseada em:
  - Data de aprovação + dias após aprovação configurados
  - Campo `daysAfterApproval` do `DeliveryInfo`
- **Status da entrega** é definido baseado no tipo:
  - `DELIVERING`: Para produtos em teste/trial
  - `IN_PRODUCTION`: Para produtos normais

### Verificações necessárias:
- [ ] `DeliverySchedule` foi criado
- [ ] Data estimada foi calculada corretamente
- [ ] Status da entrega está apropriado (`DELIVERING` ou `IN_PRODUCTION`)
- [ ] Informações de entrega (`DeliveryInfo`) estão atualizadas
- [ ] Endereço de entrega está configurado (se aplicável)
- [ ] Transportadora foi definida (se tipo `CARRIER`)

---

## ✅ 3. GESTÃO DE PRODUÇÃO

### O que acontece:
- **Estágios de produção** são configurados automaticamente
- **Status inicial** da produção é definido
- **Cronograma de produção** é estabelecido

### Verificações necessárias:
- [ ] Estágios de produção foram criados
- [ ] Status inicial está correto
- [ ] Cronograma está configurado adequadamente
- [ ] Dependências entre estágios estão definidas

---

## ✅ 4. CRIAÇÃO DE REGISTROS FINANCEIROS

### 4.1 Contas a Receber (Receivables)
#### O que acontece:
- **Título principal** é criado para o valor da venda
- **Parcelas** são geradas baseadas na condição de pagamento
- **Entrada** é criada separadamente (se houver)
- **Status inicial**: `PENDING`

#### Verificações necessárias:
- [ ] Conta a receber principal foi criada
- [ ] Valor total está correto
- [ ] Parcelas foram geradas conforme condição de pagamento
- [ ] Datas de vencimento estão corretas
- [ ] Entrada foi criada separadamente (se aplicável)
- [ ] Método de pagamento está vinculado
- [ ] Cliente está associado corretamente

### 4.2 Contas a Pagar (Payables)
#### O que acontece automaticamente:

**Comissão do Vendedor:**
- Criada apenas se comissão estiver configurada
- Valor calculado baseado na configuração (`PERCENT` ou valor fixo)
- Forma de pagamento: `SINGLE` (única vez) ou `PAYMENT_BASED` (baseada no pagamento do cliente)
- Status inicial: `PENDING`

**Custo de Entrega:**
- Criada apenas se houver custo de entrega configurado
- Valor: custo definido no `DeliveryInfo`
- Fornecedor: transportadora selecionada
- Parcela única com vencimento em 30 dias

#### Verificações necessárias:
- [ ] Comissão foi criada (se configurada)
- [ ] Valor da comissão está correto
- [ ] Forma de transferência está adequada
- [ ] Conta de entrega foi criada (se houver custo)
- [ ] Fornecedor da entrega está correto
- [ ] Datas de vencimento estão apropriadas

---

## ✅ 5. ATUALIZAÇÕES DE STATUS

### O que acontece:
- **Orçamento**: `QUOTATION` → `APPROVED`
- **Ordem**: Criada com status `PENDING`
- **Entrega**: Status baseado no tipo (`IN_PRODUCTION` ou `DELIVERING`)
- **Financeiro**: Títulos com status `PENDING`

### Verificações necessárias:
- [ ] Status do orçamento foi atualizado
- [ ] Status da ordem está correto
- [ ] Status da entrega está apropriado
- [ ] Status dos títulos financeiros está `PENDING`

---

## ✅ 6. NOTIFICAÇÕES E INTEGRAÇÕES

### O que pode acontecer:
- **Notificações** para vendedor, cliente ou produção
- **Atualizações** em sistemas integrados
- **E-mails** automáticos (se configurados)

### Verificações necessárias:
- [ ] Notificações foram enviadas
- [ ] Integrações foram executadas
- [ ] E-mails foram disparados (se configurados)

---

## 🔍 CHECKLIST DE VERIFICAÇÃO COMPLETA

### Dados Básicos
- [ ] Orçamento tem status `APPROVED` e data `approvedAt`
- [ ] Ordem de serviço foi criada e vinculada
- [ ] Todos os produtos do orçamento estão na ordem

### Entrega e Produção
- [ ] Cronograma de entrega foi criado
- [ ] Data estimada está correta
- [ ] Status de produção foi iniciado
- [ ] Estágios de produção estão configurados

### Financeiro - Recebimentos
- [ ] Conta a receber principal criada
- [ ] Parcelas geradas conforme condição
- [ ] Entrada criada separadamente (se houver)
- [ ] Valores e datas estão corretos

### Financeiro - Pagamentos
- [ ] Comissão criada (se configurada)
- [ ] Custo de entrega criado (se houver)
- [ ] Fornecedores corretos vinculados
- [ ] Datas de vencimento apropriadas

### Integrações
- [ ] Notificações enviadas
- [ ] Sistemas integrados atualizados
- [ ] Logs de processo registrados

---

## 🚨 PROBLEMAS COMUNS E SOLUÇÕES

### Ordem não criada
- Verificar se orçamento está realmente aprovado
- Confirmar se não há erros de validação
- Checar permissões do usuário

### Financeiro não gerado
- Verificar condição de pagamento configurada
- Confirmar se cliente está ativo
- Checar configurações de comissão

### Entrega sem cronograma
- Verificar se `DeliveryInfo` está configurado
- Confirmar se `daysAfterApproval` está definido
- Checar se tipo de entrega está correto

### Status inconsistentes
- Executar processo de sincronização
- Verificar integridade dos dados
- Confirmar se todas as etapas foram executadas

---

## 📊 MÉTRICAS DE MONITORAMENTO

### KPIs para acompanhar:
- **Taxa de sucesso** na criação de ordens
- **Tempo médio** entre aprovação e criação completa
- **Erros** no processo de aprovação
- **Orçamentos** com problemas financeiros
- **Entregas** sem cronograma definido

---

*Documento gerado automaticamente para controle de qualidade do processo pós-aprovação de orçamentos.*