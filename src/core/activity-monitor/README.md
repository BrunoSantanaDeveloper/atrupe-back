# Sistema de Monitoramento de Atividades de Usuários

## Visão Geral

Este módulo permite monitorar em tempo real os usuários ativos no sistema, rastrear suas últimas interações e gerar estatísticas de uso.

## Funcionalidades

- ✅ Rastreamento automático de atividades de usuários
- ✅ Identificação de usuários online em tempo real
- ✅ Histórico de atividades por usuário
- ✅ Estatísticas de uso por empresa
- ✅ Limpeza automática de sessões inativas
- ✅ Gerenciamento de múltiplas sessões por usuário

## Como Funciona

### 1. Login e Criação de Sessão

Quando um usuário faz login, o sistema:

- Gera um `sessionId` único (UUID)
- Retorna o `sessionId` na resposta do login
- O cliente deve armazenar e enviar esse `sessionId` em todas as requisições subsequentes

**Exemplo de resposta de login:**

```json
{
  "id": "user-uuid",
  "name": "João Silva",
  "email": "joao@example.com",
  "access_token": "jwt-token...",
  "sessionId": "550e8400-e29b-41d4-a716-446655440000"
}
```

### 2. Rastreamento Automático

O interceptor `ActivityTrackingInterceptor` registra automaticamente cada requisição autenticada:

- Endpoint acessado
- Método HTTP (GET, POST, PUT, DELETE)
- IP do usuário
- User Agent
- Timestamp da atividade

### 3. Header x-session-id

**IMPORTANTE:** O cliente deve incluir o header `x-session-id` em todas as requisições:

```javascript
// Exemplo em JavaScript/TypeScript
fetch('/api/endpoint', {
  headers: {
    Authorization: 'Bearer ${token}',
    'x-session-id': '550e8400-e29b-41d4-a716-446655440000',
  },
});
```

## Endpoints da API

### 1. Usuários Online

**GET** `/activity-monitor/online`

Retorna lista de usuários atualmente ativos no sistema.

**Query Parameters:**

- `companyId` (opcional): Filtrar por empresa específica
- `minutesThreshold` (opcional, padrão: 5): Considerar usuários ativos nos últimos X minutos

**Exemplo:**

```bash
GET /activity-monitor/online?companyId=company-uuid&minutesThreshold=10
```

**Resposta:**

```json
[
  {
    "userId": "user-uuid",
    "userName": "João Silva",
    "email": "joao@example.com",
    "avatar": "https://...",
    "companyId": "company-uuid",
    "companyName": "Empresa XYZ",
    "lastActive": "2025-10-20T20:45:00.000Z",
    "sessions": [
      {
        "sessionId": "session-uuid-1",
        "lastActive": "2025-10-20T20:45:00.000Z",
        "ipAddress": "192.168.1.100",
        "endpoint": "/api/clients"
      }
    ]
  }
]
```

### 2. Última Atividade de um Usuário

**GET** `/activity-monitor/user/:userId/last-activity`

Retorna a última atividade registrada de um usuário específico.

**Exemplo:**

```bash
GET /activity-monitor/user/user-uuid/last-activity
```

**Resposta:**

```json
{
  "id": "activity-uuid",
  "userId": "user-uuid",
  "sessionId": "session-uuid",
  "endpoint": "/api/quotations",
  "method": "POST",
  "ipAddress": "192.168.1.100",
  "userAgent": "Mozilla/5.0...",
  "lastActive": "2025-10-20T20:45:00.000Z",
  "createdAt": "2025-10-20T14:30:00.000Z",
  "isActive": true,
  "user": {
    "id": "user-uuid",
    "name": "João Silva",
    "email": "joao@example.com"
  }
}
```

### 3. Histórico de Atividades

**GET** `/activity-monitor/user/:userId/history`

Retorna o histórico paginado de atividades de um usuário.

**Query Parameters:**

- `limit` (opcional, padrão: 50): Número de registros por página
- `offset` (opcional, padrão: 0): Posição inicial

**Exemplo:**

```bash
GET /activity-monitor/user/user-uuid/history?limit=20&offset=0
```

**Resposta:**

```json
{
  "data": [
    {
      "id": "activity-uuid",
      "sessionId": "session-uuid",
      "endpoint": "/api/clients",
      "method": "GET",
      "lastActive": "2025-10-20T20:45:00.000Z",
      "createdAt": "2025-10-20T14:30:00.000Z",
      "isActive": true
    }
  ],
  "total": 150,
  "limit": 20,
  "offset": 0
}
```

### 4. Estatísticas da Empresa

**GET** `/activity-monitor/company/:companyId/statistics`

Retorna estatísticas de uso da empresa.

**Query Parameters:**

- `days` (opcional, padrão: 30): Período em dias para análise

**Exemplo:**

```bash
GET /activity-monitor/company/company-uuid/statistics?days=7
```

**Resposta:**

```json
{
  "totalUsers": 15,
  "totalSessions": 245,
  "activeToday": 8,
  "periodDays": 7
}
```

### 5. Logout

**POST** `/activity-monitor/logout`

Registra o logout do usuário e marca a sessão como inativa.

**Headers Required:**

- `x-session-id`: ID da sessão a ser finalizada

**Exemplo:**

```bash
POST /activity-monitor/logout
Headers:
  x-session-id: session-uuid
```

**Resposta:**

```json
{
  "message": "Logout registrado com sucesso"
}
```

## Jobs Agendados

### 1. Limpeza de Sessões Inativas

- **Frequência:** A cada hora
- **Ação:** Marca como inativas sessões sem atividade há mais de 30 minutos

### 2. Exclusão de Registros Antigos

- **Frequência:** Diariamente à meia-noite
- **Ação:** Remove registros de atividades com mais de 90 dias

## Integração no Frontend

### 1. No Login

```typescript
// Exemplo em React/Angular/Vue
async function login(email: string, password: string) {
  const response = await fetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

  const data = await response.json();

  // Armazenar token e sessionId
  localStorage.setItem('access_token', data.access_token);
  localStorage.setItem('session_id', data.sessionId);

  return data;
}
```

### 2. Em Todas as Requisições

```typescript
// Interceptor HTTP (exemplo com Axios)
axios.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  const sessionId = localStorage.getItem('session_id');

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  if (sessionId) {
    config.headers['x-session-id'] = sessionId;
  }

  return config;
});
```

### 3. No Logout

```typescript
async function logout() {
  const sessionId = localStorage.getItem('session_id');

  await fetch('/activity-monitor/logout', {
    method: 'POST',
    headers: {
      'x-session-id': sessionId,
    },
  });

  // Limpar armazenamento local
  localStorage.removeItem('access_token');
  localStorage.removeItem('session_id');
}
```

### 4. Dashboard de Usuários Online

```typescript
// Exemplo de componente React
function OnlineUsers() {
  const [onlineUsers, setOnlineUsers] = useState([]);

  useEffect(() => {
    // Atualizar a cada 30 segundos
    const interval = setInterval(async () => {
      const response = await fetch('/activity-monitor/online?minutesThreshold=5');
      const users = await response.json();
      setOnlineUsers(users);
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div>
      <h2>Usuários Online: {onlineUsers.length}</h2>
      <ul>
        {onlineUsers.map(user => (
          <li key={user.userId}>
            {user.userName} - Última atividade: {new Date(user.lastActive).toLocaleString()}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

## Estrutura do Banco de Dados

### Tabela: user_activities

```prisma
model UserActivity {
  id          String    @id @default(uuid())
  userId      String
  companyId   String?
  employeeId  String?
  sessionId   String    // UUID único da sessão
  endpoint    String?   // URL acessada
  method      String?   // GET, POST, PUT, DELETE
  ipAddress   String?
  userAgent   String?
  lastActive  DateTime  @default(now())
  createdAt   DateTime  @default(now())
  isActive    Boolean   @default(true)
  logoutAt    DateTime?
  user        User      @relation(fields: [userId], references: [id])

  @@index([userId])
  @@index([sessionId])
  @@index([companyId])
  @@index([lastActive])
  @@index([isActive])
}
```

## Casos de Uso

### 1. Monitorar Usuários Ativos em Tempo Real

Útil para dashboards administrativos, mostrar quem está usando o sistema no momento.

### 2. Auditoria de Atividades

Rastrear quando e como os usuários interagem com o sistema.

### 3. Análise de Uso

Identificar horários de pico, usuários mais ativos, funcionalidades mais utilizadas.

### 4. Segurança

Detectar múltiplas sessões simultâneas ou acessos suspeitos.

### 5. Suporte ao Cliente

Ver a última atividade de um usuário que reportou um problema.

## Considerações de Performance

- O rastreamento é **assíncrono** e não bloqueia requisições
- Índices no banco de dados otimizam consultas
- Limpeza automática previne crescimento excessivo da tabela
- Sessões inativas são marcadas mas não deletadas imediatamente (para histórico)

## Segurança

- Apenas usuários autenticados são rastreados
- Dados sensíveis não são armazenados nos logs de atividade
- IPs e User Agents são opcionais e podem ser removidos se necessário
- Endpoints protegidos por JWT Guard

## Troubleshooting

### Usuários não aparecem como online

- Verificar se o `x-session-id` está sendo enviado nas requisições
- Confirmar que o `minutesThreshold` não é muito curto
- Checar se o interceptor está registrado globalmente

### Sessões ficam ativas indefinidamente

- Verificar se o job de limpeza está rodando (ScheduleModule habilitado)
- Confirmar que o endpoint de logout está sendo chamado

### Performance degradada

- Aumentar o período de retenção de dados antigos (padrão: 90 dias)
- Considerar adicionar mais índices se necessário
- Revisar frequência dos jobs agendados
