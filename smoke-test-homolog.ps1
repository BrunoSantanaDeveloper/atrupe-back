# Testa se a API de Homolog (dev.atrupe.com.br) está respondendo
# e simula o fluxo de recuperacao de senha

[System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$API_BASE = if ($env:API_URL) { $env:API_URL } else { "https://dev.atrupe.com.br" }

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  SMOKE TEST - API ($API_BASE)" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
$hasErrors = $false

# --- Teste 1: API está online? ---
Write-Host "[1] Verificando se a API está online..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "$API_BASE" -Method Get -TimeoutSec 10
    Write-Host "    PASS - API respondendo" -ForegroundColor Green
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -ge 200 -and $code -lt 500) {
        Write-Host "    PASS - API respondendo (HTTP $code)" -ForegroundColor Green
    } else {
        Write-Host "    FAIL - Resposta: $($_.Exception.Message)" -ForegroundColor Red
        $hasErrors = $true
    }
}

# --- Teste 2: Rota de login existe? ---
Write-Host "[2] Verificando rota POST /auth/login..." -ForegroundColor Yellow
try {
    $body = '{"username":"smoke@test.com","password":"wrong"}' 
    $loginTest = Invoke-RestMethod -Uri "$API_BASE/auth/login" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 10
    Write-Host "    INFO - Retornou 2xx (inesperado para credenciais erradas)" -ForegroundColor Yellow
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -eq 401) {
        Write-Host "    PASS - Rota /auth/login existe e rejeita credenciais invalidas (401)" -ForegroundColor Green
    } elseif ($code -eq 429) {
        Write-Host "    PASS - Rota /auth/login existe com rate limit ativo (429)" -ForegroundColor Green
    } else {
        Write-Host "    INFO - HTTP $code - $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# --- Teste 3: Rota de recuperação de senha existe? ---
Write-Host "[3] Verificando rota POST /user/forgot-password..." -ForegroundColor Yellow
try {
    $body = '{"email":"smoke@atrupe.invalid"}'
    $forgotTest = Invoke-RestMethod -Uri "$API_BASE/user/forgot-password" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 10
    Write-Host "    PASS - Rota /user/forgot-password respondeu (smoke OK)" -ForegroundColor Green
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -ge 200 -and $code -lt 500) {
        Write-Host "    PASS - Rota /user/forgot-password existe (HTTP $code)" -ForegroundColor Green
    } else {
        Write-Host "    FAIL - HTTP $code - $($_.Exception.Message)" -ForegroundColor Red
        $hasErrors = $true
    }
}

# --- Teste 4: Rota de redefinição de senha existe? ---
Write-Host "[4] Verificando rota POST /user/reset-password..." -ForegroundColor Yellow
try {
    $body = '{"token":"token-invalido-smoke","password":"NovaSenha123!"}'
    $resetTest = Invoke-RestMethod -Uri "$API_BASE/user/reset-password" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 10
    Write-Host "    INFO - Respondeu 2xx com token invalido (verificar logica)" -ForegroundColor Yellow
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -eq 401) {
        Write-Host "    PASS - Rota /user/reset-password existe e rejeita token invalido (401)" -ForegroundColor Green
    } elseif ($code -ge 200 -and $code -lt 500) {
        Write-Host "    PASS - Rota /user/reset-password existe (HTTP $code)" -ForegroundColor Green
    } else {
        Write-Host "    FAIL - HTTP $code - $($_.Exception.Message)" -ForegroundColor Red
        $hasErrors = $true
    }
}

# --- Teste 5: Rota de cadastro de nova conta existe? ---
Write-Host "[5] Verificando rota POST /user (Cadastro de conta)..." -ForegroundColor Yellow
try {
    $body = '{"email":"smoke-test-new-account@atrupe.invalid","name":"Smoke Test","companyName":"Smoke Test Inc","phone":"11999999999"}'
    $registerTest = Invoke-RestMethod -Uri "$API_BASE/user" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 10
    Write-Host "    PASS - Rota /user respondeu com sucesso (smoke OK)" -ForegroundColor Green
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -ge 200 -and $code -lt 500) {
        Write-Host "    PASS - Rota /user existe (HTTP $code)" -ForegroundColor Green
    } else {
        Write-Host "    FAIL - HTTP $code - $($_.Exception.Message)" -ForegroundColor Red
        $hasErrors = $true
    }
}

# --- Autenticação com conta de smoke test ---
$smokeEmail = $env:SMOKE_USER_EMAIL
$smokePassword = $env:SMOKE_USER_PASSWORD

if ($smokeEmail -and $smokePassword) {
    Write-Host "[6] Autenticando com conta de smoke test..." -ForegroundColor Yellow
    try {
        $loginBody = "{`"username`":`"$smokeEmail`",`"password`":`"$smokePassword`"}"
        $loginResult = Invoke-RestMethod -Uri "$API_BASE/auth/login" -Method Post -Body $loginBody -ContentType "application/json" -TimeoutSec 15
        $token = $loginResult.access_token
        $headers = @{ Authorization = "Bearer $token" }
        Write-Host "    PASS - Login de smoke test OK" -ForegroundColor Green

        # --- Teste 7: Listar cotações ---
        Write-Host "[7] Verificando GET /sale/quotation (listagem autenticada)..." -ForegroundColor Yellow
        $quotations = Invoke-RestMethod -Uri "$API_BASE/sale/quotation?page=1&limit=1" -Headers $headers -TimeoutSec 10
        Write-Host "    PASS - Rota /sale/quotation respondeu OK" -ForegroundColor Green

        # --- Teste 8: Listar contas a receber ---
        Write-Host "[8] Verificando GET /financial/receivable..." -ForegroundColor Yellow
        $receivables = Invoke-RestMethod -Uri "$API_BASE/financial/receivable?page=1&limit=1" -Headers $headers -TimeoutSec 10
        Write-Host "    PASS - Rota /financial/receivable respondeu OK" -ForegroundColor Green

        # --- Teste 9: Listar contas a pagar ---
        Write-Host "[9] Verificando GET /financial/payable..." -ForegroundColor Yellow
        $payables = Invoke-RestMethod -Uri "$API_BASE/financial/payable?page=1&limit=1" -Headers $headers -TimeoutSec 10
        Write-Host "    PASS - Rota /financial/payable respondeu OK" -ForegroundColor Green

    } catch {
        $msg = $_.Exception.Message
        if ($_.Exception.Response) {
            try {
                $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
                $body = $reader.ReadToEnd()
                $msg = "$msg - Response: $body"
            } catch {}
        }
        Write-Host "    FAIL - Smoke autenticado falhou: $msg" -ForegroundColor Red
        $hasErrors = $true
    }
} else {
    Write-Host "[6-9] SKIP - Variáveis SMOKE_USER_EMAIL/PASSWORD não configuradas" -ForegroundColor Yellow
}

# --- Contas de teste por plano: login, chaves do plano e gates ---
# SMOKE_PLAN_ACCOUNTS: JSON com e-mail e senha do administrador de cada conta
# e2e-<plano> (src/scripts/test-accounts; docs/test-accounts.md), por exemplo
#   {"START":{"email":"admin.e2e-start@...","password":"..."},"LITE":{...}}
# Plano fora do JSON fica de fora. O que se espera de cada login está em
# scripts/smoke/plan-expectations.json; as rotas com gate, em
# scripts/smoke/plan-gates.json (abaixo do plano mínimo: 403
# FEATURE_NOT_AVAILABLE com a chave; do plano mínimo para cima: 2xx).

# Status e corpo de uma chamada, com ou sem erro HTTP (PowerShell 5.1 e 7).
function Invoke-SmokeRequest {
    param(
        [string]$Method,
        [string]$Url,
        [hashtable]$Headers,
        [string]$Body
    )
    $params = @{ Uri = $Url; Method = $Method; TimeoutSec = 15; UseBasicParsing = $true }
    if ($Headers) { $params.Headers = $Headers }
    if ($Body) {
        $params.Body = [System.Text.Encoding]::UTF8.GetBytes($Body)
        $params.ContentType = 'application/json; charset=utf-8'
    }
    $status = 0
    $content = ''
    try {
        $response = Invoke-WebRequest @params
        $status = [int]$response.StatusCode
        $content = [string]$response.Content
    } catch {
        if ($_.Exception.Response) {
            $status = [int]$_.Exception.Response.StatusCode
            if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
                $content = $_.ErrorDetails.Message
            } else {
                try {
                    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
                    $content = $reader.ReadToEnd()
                } catch {}
            }
        } else {
            $content = $_.Exception.Message
        }
    }
    $json = $null
    if ($content) {
        try { $json = $content | ConvertFrom-Json } catch {}
    }
    return @{ Status = $status; Body = $json; Raw = $content }
}

$planAccountsRaw = $env:SMOKE_PLAN_ACCOUNTS

if ($planAccountsRaw) {
    Write-Host "[10] Contas por plano: login, plano, bloqueio, chaves e max_users..." -ForegroundColor Yellow
    $smokeDir = Join-Path $PSScriptRoot 'scripts/smoke'
    $planExpectations = (Get-Content -Raw -Encoding UTF8 (Join-Path $smokeDir 'plan-expectations.json') | ConvertFrom-Json).plans
    $planGates = Get-Content -Raw -Encoding UTF8 (Join-Path $smokeDir 'plan-gates.json') | ConvertFrom-Json
    $planOrder = @($planGates.planOrder)
    $planTokens = @{}
    $planAccounts = $null
    try {
        $planAccounts = $planAccountsRaw | ConvertFrom-Json
    } catch {
        Write-Host "    FAIL - SMOKE_PLAN_ACCOUNTS não é um JSON válido" -ForegroundColor Red
        $hasErrors = $true
    }

    if ($planAccounts) {
        foreach ($plan in $planOrder) {
            $account = $planAccounts.$plan
            if (-not $account) {
                Write-Host "    SKIP - $($plan): sem conta em SMOKE_PLAN_ACCOUNTS" -ForegroundColor Yellow
                continue
            }
            $expected = $planExpectations.$plan
            if (-not $expected) {
                Write-Host "    FAIL - $($plan): sem expectativa em plan-expectations.json" -ForegroundColor Red
                $hasErrors = $true
                continue
            }

            $loginBody = @{ username = [string]$account.email; password = [string]$account.password } | ConvertTo-Json -Compress
            $login = Invoke-SmokeRequest -Method 'Post' -Url "$API_BASE/auth/login" -Body $loginBody
            if ($login.Status -eq 429) {
                # O login tem limite por IP (10/min); os logins por plano somam aos de cima.
                Write-Host "    INFO - $($plan): limite de login (429); nova tentativa em 61 s" -ForegroundColor Yellow
                Start-Sleep -Seconds 61
                $login = Invoke-SmokeRequest -Method 'Post' -Url "$API_BASE/auth/login" -Body $loginBody
            }
            if ($login.Status -lt 200 -or $login.Status -ge 300 -or -not $login.Body.access_token) {
                Write-Host "    FAIL - $($plan): login falhou (HTTP $($login.Status))" -ForegroundColor Red
                $hasErrors = $true
                continue
            }
            $planTokens[$plan] = $login.Body.access_token

            $company = $login.Body.company
            $expectedMaxUsers = [int]$expected.maxUsers + [int]$expected.additionalUsers
            $problems = @()
            if (-not $company) {
                $problems += 'login sem empresa'
            } else {
                if ($company.subscription -ne $plan) { $problems += "plano $($company.subscription)" }
                if ($company.blockLevel -ne 'NONE') { $problems += "blockLevel $($company.blockLevel)" }
                $features = @($company.features)
                foreach ($key in @($expected.has)) {
                    if ($features -notcontains $key) { $problems += "sem $key" }
                }
                foreach ($key in @($expected.hasNot)) {
                    if ($features -contains $key) { $problems += "com $key (de plano acima)" }
                }
                # O login soma ao max_users do plano os usuários adicionais da assinatura.
                if ($company.limits.max_users -ne $expectedMaxUsers) {
                    $problems += "max_users $($company.limits.max_users), esperado $expectedMaxUsers ($($expected.maxUsers) do plano + $($expected.additionalUsers) adicional)"
                }
            }
            if ($problems.Count -gt 0) {
                Write-Host "    FAIL - $($plan): $($problems -join '; ')" -ForegroundColor Red
                $hasErrors = $true
            } else {
                Write-Host "    PASS - $($plan): plano, blockLevel NONE, chaves e max_users $expectedMaxUsers conferem" -ForegroundColor Green
            }
        }
    }

    if ($planTokens.Count -gt 0) {
        Write-Host "[11] Gates de plano (scripts/smoke/plan-gates.json)..." -ForegroundColor Yellow
        foreach ($gate in @($planGates.gates)) {
            $minRank = [array]::IndexOf($planOrder, [string]$gate.minPlan)
            $blocked = @()
            $allowed = @()
            $gateFailures = @()
            foreach ($plan in $planOrder) {
                if (-not $planTokens.ContainsKey($plan)) { continue }
                $headers = @{ Authorization = "Bearer $($planTokens[$plan])" }
                $result = Invoke-SmokeRequest -Method $gate.method -Url "$API_BASE$($gate.path)" -Headers $headers
                $userMessage = $null
                if ($result.Body) { $userMessage = $result.Body.userMessage }
                if ([array]::IndexOf($planOrder, $plan) -lt $minRank) {
                    if ($result.Status -eq 403 -and $userMessage.code -eq 'FEATURE_NOT_AVAILABLE' -and @($userMessage.feature) -contains $gate.feature) {
                        $blocked += $plan
                    } else {
                        $gateFailures += "$($plan): esperado 403 FEATURE_NOT_AVAILABLE ($($gate.feature)), veio HTTP $($result.Status) $($userMessage.code)"
                    }
                } elseif ($result.Status -ge 200 -and $result.Status -lt 300) {
                    $allowed += $plan
                } else {
                    $gateFailures += "$($plan): esperado 2xx, veio HTTP $($result.Status) $($userMessage.code)"
                }
            }
            $label = "$($gate.method) $($gate.path) ($($gate.feature), $($gate.minPlan)+)"
            if ($gateFailures.Count -gt 0) {
                Write-Host "    FAIL - $label" -ForegroundColor Red
                foreach ($failure in $gateFailures) {
                    Write-Host "           $failure" -ForegroundColor Red
                }
                $hasErrors = $true
            } else {
                Write-Host "    PASS - $($label): 403 em [$($blocked -join ', ')]; 2xx em [$($allowed -join ', ')]" -ForegroundColor Green
            }
        }
    }
} else {
    Write-Host "[10-11] SKIP - Variável SMOKE_PLAN_ACCOUNTS não configurada" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Smoke tests concluidos" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

if ($hasErrors) {
    Write-Host "Falha no Smoke Test!" -ForegroundColor Red
    exit 1
} else {
    Write-Host "Sucesso: API está operando como esperado!" -ForegroundColor Green
    exit 0
}
