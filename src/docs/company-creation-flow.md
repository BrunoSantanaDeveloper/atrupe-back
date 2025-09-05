# 🏢 Fluxo de Criação de Nova Empresa

Este documento detalha todos os itens que são criados automaticamente durante a criação de uma nova empresa no sistema.

## 📋 Visão Geral

O processo de criação de uma nova empresa é dividido em **3 fases principais** e cria **mais de 250 itens** automaticamente, garantindo que a empresa tenha toda a estrutura básica necessária para operar.

---

## **Fase 1: Criação da Empresa**
*Método: `createMainCompany`*

### 1. Empresa Principal
- Dados básicos (nome, razão social, CNPJ, email, telefones)
- Configurações de personalização (logo, favicon, textos)
- Redes sociais (Instagram, Facebook, LinkedIn)
- Data de fim do período de teste (7 dias)

### 2. Endereço da Empresa
- Criado se fornecido nos dados de entrada
- Vinculado à empresa com `ownerType: 'COMPANY'`

---

## **Fase 2: Itens Padrão da Empresa**
*Método: `createDefaultItems`*

### **1. Setores (16 setores)**
*Fonte: `BASE_SECTORS`*

| Tipo | Setores |
|------|---------|
| **Administrativos** | Administração, Comercial |
| **Produção** | Almoxarifado, CNC, Confecção, Criação, Frota, Gráfica Rápida, Impressão, Instalação, Locação de Painéis, Marcenaria, Pintura, Produção, Serigrafia, Serralheria |

### **2. Unidades de Medida**
*Padrões definidos na empresa*

| Tipo | Unidade Padrão |
|------|----------------|
| Comprimento | MT (Metros) |
| Peso | KG (Quilogramas) |
| Capacidade | LT (Litros) |
| Distância | KM (Quilômetros) |
| Duração | HH (Horas) |
| Unidade | UN (Unidades) |
| Área | M2 (Metros quadrados) |

### **3. Séries de Venda (3 séries)**
*Configurações para orçamentos*

| Código | Título | Descrição | Padrão |
|--------|--------|-----------|--------|
| T1 | Orçamento | Treinamento | ✅ |
| V1 | Orçamento | Vendas Diversas | ❌ |
| SL | Orçamento | Cortesia/Retrabalho | ❌ |

### **4. Métodos de Pagamento (10 métodos)**

- Depósito Bancário (DEP)
- Dinheiro (DIN)  
- Link de Pagamento (LKP)
- Pix (PIX)
- Cartão de Crédito (CRD)
- Boleto Bancário (BOL)
- Cartão de Débito (DEB)
- Cheque (CHQ)
- Permuta (PER)
- Pagamento Mensal (PGM)

### **5. Caixa da Empresa**
*Configuração financeira básica*

- **Conta Bancária**: "Caixa Empresa"
- **Registro de Caixa**: Saldo inicial R$ 0,00, status ABERTO
- **Controles de Caixa**: Configurados para todos os métodos de pagamento

### **6. Condições de Pagamento (5 condições)**
*Fonte: `BASE_PAYMENT_CONDITIONS`*

| Condição | Parcelamento | Tipo Recebimento | Intervalo |
|----------|--------------|------------------|-----------|
| Pix | Não | À vista | 0 dias |
| Dinheiro | Não | À vista | 0 dias |
| Cartão de Crédito | Sim (1-3x) | Parcelado | 30 dias |
| Cartão de Débito | Não | Parcelado | 30 dias |
| Boleto | Não | À vista | 0 dias |

#### **Limites de Crédito Padrão**
- **Pessoa Física**: R$ 2.000 - R$ 200.000
- **Pessoa Jurídica**: R$ 5.000 - R$ 500.000

### **7. Naturezas Financeiras (9 naturezas + 68 subcategorias)**
*Fonte: `BASE_NATURES`*

#### **Receitas (4 naturezas)**
- **Vendas**: Prestação de Serviços, Venda de Mercadorias, Receita de Aluguéis, Receitas Diversas
- **Sócios**: Aporte Sócios
- **Empréstimos e Financiamentos**: Entrada Empréstimo/Financiamento
- **Investimentos**: Juros recebidos, Venda de Ativo Imobilizado

#### **Despesas (5 naturezas)**
- **Administrativo** (15 subcategorias): Material de Limpeza, Água, Contabilidade, Internet, Material de Escritório, Aluguel, Alvará/IPTU, Energia Elétrica, Copa Cozinha, Marketing, Sistemas/Softwares, Manutenção Predial, Manutenção de Máquinas, Telefone
- **Operacional** (10 subcategorias): Matéria Prima, Produtos para Revenda, Terceirizados de O.S., Aluguel de Máquinas, Despesas de Viagem, Comissão de Venda, Frete de Compra, Frete de Venda, DAS - Simples Nacional, DARE
- **Frota** (11 subcategorias): Combustível, Estacionamento, Lavação, Multas, Manutenção, Revisão, Seguro, Emplacamento, Pneus, Pedágio, Veículos de Colaboradores
- **Colaboradores/RH** (14 subcategorias): Salários, Horas Extras, Ajuda de Custo, Vale Transporte, Alimentação, INSS, FGTS, GPS, Férias, 13° Salário, Atestados e Taxas, Cursos e Treinamentos, Rescisão, Pró-Labore
- **Despesas Financeiras** (4 subcategorias): Tarifas Bancárias, Tarifa de Cartão de Crédito, Juros, IOF
- **Sócios**: Retirada de Lucro
- **Investimentos**: Equipamentos de Escritório, Equipamentos de Produção, Outros
- **Empréstimos e Financiamentos**: Amortização de Empréstimo e Financiamento

### **8. Roles/Cargos (20 roles padrão)**
*Fonte: `BASE_ROLES`*

#### **Por Setor:**
- **Administração**: Auxiliar Financeiro, Gerente Geral, Serviços Gerais
- **Comercial**: Gerente Comercial, Vendedor
- **Produção**: Aplicador, Gerente de Produção, Acabamento
- **Pintura**: Pintor
- **Locação de Painéis**: Montador
- **Marcenaria**: Marceneiro
- **Criação**: Designer
- **Instalação**: Instalador
- **Impressão**: Impressor
- **Serigrafia**: Serigrafo
- **Confecção**: Costureira
- **Frota**: Motorista
- **Serralheria**: Serralheiro
- **Gráfica Rápida**: Atendente
- **CNC**: Operador CNC

### **9. Perfil de Vendedor Padrão**
- **Nome**: "Vendedor Padrão"
- **Comissão**: 5%
- **Desconto Máximo**: 10%
- **Valor Mínimo**: R$ 0,00
- **Permissões**: Básicas (sem aprovação de pré-cadastro, sem cancelamento de venda)

### **10. Categorias de Produto (26 categorias)**
*Fonte: `BASE_PRODUCTS_CATEGORIES`*

#### **Por Setor:**
- **Impressão**: Lonas, Adesivos, Suprimentos Impressão, Revenda Impressão
- **CNC**: MDF, Acrílicos, PVC, Suprimentos CNC, Revenda CNC
- **Gráfica Rápida**: Papéis, Suprimentos Gráfica, Revenda Gráfica Rápida
- **Confecção**: Tecidos, Aviamentos
- **Criação**: Serviço Criação
- **Frota**: Deslocamento
- **Instalação**: Serviço Instalação, Instalação Terceirizada
- **Locação de Painéis**: Locação
- **Marcenaria**: Chapas, Acabamentos
- **Pintura**: Serviços Pintura
- **Produção**: Acabamentos
- **Serigrafia**: Serigrafia
- **Serralheria**: Estruturas, Letra Caixa

### **11. Produtos Padrão (25 produtos)**
*Fonte: `BASE_PRODUCTS`*

#### **Exemplos de Produtos:**
- **Adesivos**: Blackout Impresso, Brilho Impresso, Fosco Impresso, etc.
- **Lonas**: Front Light, Back Light, Banner, etc.
- **Estruturas**: Placas de identificação, Totens, etc.
- **Serviços**: Criação de arte, Instalação, etc.

*Todos os produtos são criados como editáveis (descrição e valor) com preços zerados*

### **12. Categorias de Cliente e Fornecedor (13 categorias)**

#### **Categorias de Cliente (8):**
- Comércio
- Indústria  
- Serviços
- Agências de Publicidade e Marketing
- Estúdios de Fotografia
- Arquiteto/Decorador
- Saúde
- Terceirizados

#### **Categorias de Fornecedor (5):**
- Serviços Administrativos/Gerais
- Suprimentos Gerais
- Equipamentos e Manutenção
- Serviços Terceirizados
- Logística e Transporte

### **13. Cliente e Fornecedor Exemplo**

#### **Cliente Exemplo:**
- **Tipo**: Pessoa Física
- **Nome**: "Cliente Exemplo"
- **Email**: cliente.exemplo@email.com
- **CPF**: 012.345.678-90
- **Limite**: R$ 0 - R$ 1.000

#### **Fornecedor Exemplo:**
- **Tipo**: Pessoa Jurídica
- **Nome**: "Fornecedor Exemplo LTDA"
- **Email**: fornecedor.exemplo@email.com
- **CNPJ**: 12.345.678/0001-90
- **Limite**: R$ 0 - R$ 5.000

### **14. Despesas Programadas (8 despesas)**
*Fonte: `BASE_SCHEDULED_EXPENSES`*

| Descrição | Vencimento | Recorrência | Fornecedor |
|-----------|------------|-------------|------------|
| Sistema de gestão | Dia 10 | Mensal | Atrupe Sistemas |
| Aluguel | Dia 8 | Mensal | Aluguel |
| Energia Elétrica | Dia 15 | Mensal | Energia Elétrica |
| Água | Dia 15 | Mensal | Água |
| Telefone | Dia 10 | Mensal | Telefone |
| Internet | Dia 15 | Mensal | Internet |
| Contador | Dia 10 | Mensal | Contador |
| Salários | Dia 5 | Mensal | - |

### **15. Motivos e Status de Orçamento**
*Fonte: `BASE_REASONS` e `BASE_STATUS_QUOTATIONS`*

- **Motivos de rejeição** para controle de orçamentos
- **Status de orçamento** com cores personalizadas

---

## **Fase 3: Primeiro Acesso do Usuário**
*Método: `createFirstAccess`*

### **16. Role Administrativo**
- **Nome**: "Admin"
- **Setor**: Administração
- **Permissões**: Administrativas completas (`isAdmin: true`)

### **17. Perfil de Vendedor Admin**
- **Nome**: "Admin"
- **Comissão**: 0%
- **Desconto Máximo**: 100%
- **Valor Mínimo**: R$ 0,00
- **Permissões**: Todas (aprovação, cancelamento, etc.)

### **18. Funcionário Administrador**
- Vincula o usuário criador da empresa
- Associa ao role "Admin"
- Conecta ao setor "Administração"
- Define como vendedor "Admin"

---

## 📊 **Resumo Quantitativo**

| Categoria | Quantidade |
|-----------|------------|
| **Empresa + Endereço** | 2 |
| **Setores** | 16 |
| **Roles/Cargos** | 21 (20 + 1 Admin) |
| **Métodos de Pagamento** | 10 |
| **Condições de Pagamento** | 5 |
| **Caixa + Controles** | 12 |
| **Naturezas + Subcategorias** | 77 (9 + 68) |
| **Categorias de Produto** | 26 |
| **Produtos** | 25 |
| **Categorias Cliente/Fornecedor** | 13 |
| **Cliente + Fornecedor Exemplo** | 2 |
| **Despesas Programadas** | 8 |
| **Perfis de Vendedor** | 2 |
| **Funcionário Admin** | 1 |
| **Motivos + Status** | ~10 |

### **🎯 Total: ~250+ itens criados automaticamente**

---

## 🔄 **Ordem de Execução**

A ordem é importante devido às dependências entre os itens:

1. **Setores** → Base para roles, categorias e produtos
2. **Unidades de medida** → Independente
3. **Séries de venda** → Independente  
4. **Métodos de pagamento** → Base para caixa e condições
5. **Caixa** → Depende dos métodos de pagamento
6. **Condições de pagamento** → Depende dos métodos de pagamento
7. **Naturezas** → Independente
8. **Roles** → Depende dos setores ✨
9. **Vendedor** → Independente
10. **Categorias de produto** → Depende dos setores
11. **Produtos** → Depende dos setores e categorias
12. **Categorias de cliente** → Independente
13. **Cliente e fornecedor** → Depende das categorias
14. **Despesas programadas** → Pode usar naturezas
15. **Motivos e status** → Independente

---

## 📝 **Observações**

- Todos os itens são criados com `isActive: true` por padrão (definido no schema Prisma)
- Preços de produtos são zerados por padrão
- Limites de crédito têm valores sugeridos mas podem ser alterados
- O sistema verifica se itens já existem antes de criar (evita duplicação)
- Caso algum setor não seja encontrado, o role correspondente é ignorado com aviso no log

---

*Documento atualizado em: Janeiro 2025*  
*Versão: 1.0*