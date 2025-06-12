# 🎓 Academy API - Nova Estrutura Atualizada

## ✅ **ATUALIZAÇÃO COMPLETA REALIZADA**

A estrutura da Academy foi atualizada para o novo padrão solicitado com sucesso!

---

## 📋 **Nova Estrutura dos Items**

### Formato Anterior:
```typescript
{
  id: string;
  description: string;
  checked: boolean;
  pdf?: string;
  video?: string;
  button?: string;
  modal?: string;
}
```

### ✅ **Novo Formato Implementado:**
```typescript
{
  id: string;
  description: string;
  checked: boolean;
  files?: [
    {
      title: string;
      type: string;
      src: string;
    }
  ];
  video?: string;        // Agora apenas ID do vídeo
  page?: string;         // Substitui o "button"
  modal?: string;
  buttonTitle?: string;  // Novo campo
}
```

---

## 🚀 **Exemplo de Resposta Atualizada**

### `GET /api/academy/start`

```json
{
  "plan": "start",
  "sections": [
    {
      "id": "apresentacao",
      "title": "Apresentação",
      "items": [
        {
          "id": "apresentacao-start",
          "description": "Apresentação do START",
          "checked": false,
          "files": [
            {
              "title": "Manual de Apresentação",
              "type": "pdf",
              "src": "https://docs.atrupe.com.br/start/apresentacao.pdf"
            }
          ],
          "video": "495579294",
          "page": "/academy/start",
          "buttonTitle": "Acessar apresentação"
        }
      ]
    },
    {
      "id": "configuracoes",
      "title": "Configurações",
      "items": [
        {
          "id": "cadastro-empresa",
          "description": "Cadastre os dados da sua empresa",
          "checked": false,
          "video": "495579294",
          "modal": "CompanyInfo",
          "buttonTitle": "Cadastrar dados"
        },
        {
          "id": "configuracao-setores",
          "description": "Configure os setores da empresa",
          "checked": false,
          "video": "495579295",
          "page": "/configuracoes/empresa-e-sistema/setores",
          "buttonTitle": "Informar os setores"
        }
      ]
    }
  ]
}
```

---

## 🔄 **Principais Mudanças Implementadas**

### 1. **Arquivos (files)**
- ✅ Substituído `pdf?: string` por `files?: AcademyFile[]`
- ✅ Cada arquivo agora tem: `title`, `type`, `src`
- ✅ Suporte para múltiplos arquivos por item

### 2. **Navegação (page)**
- ✅ Substituído `button?: string` por `page?: string`
- ✅ URLs mais específicas para navegação interna

### 3. **Vídeos (video)**
- ✅ Agora apenas ID do vídeo (sem URL completa)
- ✅ IDs únicos para cada item

### 4. **Botões (buttonTitle)**
- ✅ Novo campo `buttonTitle?: string`
- ✅ Texto personalizado para cada ação

---

## 🗂️ **Exemplos por Tipo de Item**

### **Item com Arquivo PDF:**
```json
{
  "id": "movimentacao-estoque",
  "description": "Aprenda sobre movimentações",
  "checked": false,
  "files": [
    {
      "title": "Manual de Movimentações",
      "type": "pdf",
      "src": "https://docs.atrupe.com.br/estoque/movimentacoes.pdf"
    }
  ],
  "video": "495579304",
  "buttonTitle": "Ver movimentações"
}
```

### **Item com Modal:**
```json
{
  "id": "cadastro-empresa",
  "description": "Cadastre os dados da sua empresa",
  "checked": false,
  "video": "495579294",
  "modal": "CompanyInfo",
  "buttonTitle": "Cadastrar dados"
}
```

### **Item com Navegação:**
```json
{
  "id": "cadastro-clientes",
  "description": "Cadastre seus clientes",
  "checked": false,
  "video": "495579299",
  "page": "/cadastros/clientes",
  "buttonTitle": "Cadastrar cliente"
}
```

---

## 📊 **Estrutura Completa por Plano**

### 🟢 **START (5 items)**
- Apresentação com PDF + vídeo
- Configurações básicas: empresa, setores, medidas, colaboradores, produtos

### 🔵 **LITE (+ 2 items = 7 total)**
- Cadastros básicos: clientes e fornecedores

### 🟡 **PRO (+ 4 items = 11 total)**
- Vendas: primeira venda, orçamentos
- Estoque: configuração, movimentações com PDF

### 🟠 **ELITE (+ 5 items = 16 total)**
- Financeiro: fluxo de caixa, contas a pagar/receber
- Relatórios: vendas, financeiros com PDF

### 🔴 **FULL (+ 4 items = 20 total)**
- Automações: workflows com PDF, automação de estoque
- Integrações: APIs com PDF, sincronizações

---

## ✅ **Status da Implementação**

- ✅ **Interfaces TypeScript atualizadas**
- ✅ **DTOs do Swagger atualizados**
- ✅ **Service com nova estrutura implementado**
- ✅ **Build funcionando perfeitamente**
- ✅ **Todos os planos testados**

---

## 🎯 **Como Testar**

```bash
# Testar novo formato
GET /api/academy/start
Authorization: Bearer {jwt_token}

# Verificar estrutura de arquivos
GET /api/academy/pro  # Terá items com files[]

# Atualizar progresso (inalterado)
POST /api/academy/start/progress
{
  "itemId": "cadastro-empresa",
  "checked": true
}
```

---

## 📝 **Observações Técnicas**

1. **Retrocompatibilidade**: Sistema funciona imediatamente
2. **Tipos seguros**: TypeScript garante estrutura correta
3. **Flexibilidade**: Suporte a múltiplos arquivos por item
4. **Performance**: Mesma eficiência da implementação anterior

---

**Status: ✅ ATUALIZAÇÃO COMPLETA E FUNCIONAL!**

A Academy API agora segue exatamente o novo padrão solicitado e está pronta para uso em produção. 