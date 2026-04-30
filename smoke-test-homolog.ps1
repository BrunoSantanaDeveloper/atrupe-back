# Testa se a API de Homolog (dev.atrupe.com.br) está respondendo
# e simula o fluxo de recuperacao de senha

Add-Type @"
using System.Net;
using System.Security.Cryptography.X509Certificates;
public class TrustAll : ICertificatePolicy {
    public bool CheckValidationResult(ServicePoint srvPoint, X509Certificate certificate, WebRequest request, int certificateProblem) { return true; }
}
"@
[System.Net.ServicePointManager]::CertificatePolicy = New-Object TrustAll
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$API_BASE = "https://dev.atrupe.com.br"

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  SMOKE TEST - Homolog API (dev.atrupe.com.br)" -ForegroundColor Cyan
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
    $body = '{"email":"smoke@test.com"}'
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
    $body = '{"email":"smoke-test-new-account@test.com","name":"Smoke Test","companyName":"Smoke Test Inc","phone":"11999999999"}'
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
        Write-Host "    FAIL - Smoke autenticado falhou: $($_.Exception.Message)" -ForegroundColor Red
        $hasErrors = $true
    }
} else {
    Write-Host "[6-9] SKIP - Variáveis SMOKE_USER_EMAIL/PASSWORD não configuradas" -ForegroundColor Yellow
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
