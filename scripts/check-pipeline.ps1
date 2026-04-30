param (
    [string]$Repository = "atrupe-back",
    [string]$Workspace = "tribodev"
)

# Verifica se há credenciais configuradas
if (-not $env:BITBUCKET_EMAIL -or -not $env:BITBUCKET_TOKEN) {
    Write-Host "Erro: Variaveis de ambiente BITBUCKET_EMAIL e BITBUCKET_TOKEN nao configuradas." -ForegroundColor Red
    Write-Host "Configure-as no seu ambiente local para utilizar este script." -ForegroundColor Yellow
    exit 1
}

$email = $env:BITBUCKET_EMAIL
$token = $env:BITBUCKET_TOKEN
$b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${email}:${token}"))
$headers = @{ Authorization = "Basic $b64"; Accept = "application/json" }

Write-Host "Buscando o ultimo pipeline no repositorio '$Repository'..." -ForegroundColor Cyan

try {
    $pipes = Invoke-RestMethod -Uri "https://api.bitbucket.org/2.0/repositories/$Workspace/$Repository/pipelines/?sort=-created_on&pagelen=1" -Headers $headers -Method Get -ErrorAction Stop
    $latest = $pipes.values[0]
    
    Write-Host ""
    Write-Host "Pipeline #$($latest.build_number)" -ForegroundColor White
    Write-Host "Estado: $($latest.state.name)" -ForegroundColor Yellow
    Write-Host "Criado em: $($latest.created_on)" -ForegroundColor Gray
    
    if ($latest.state.name -eq "COMPLETED") {
        if ($latest.state.result.name -eq "SUCCESSFUL") {
            Write-Host "Resultado: $($latest.state.result.name)" -ForegroundColor Green
        } else {
            Write-Host "Resultado: $($latest.state.result.name)" -ForegroundColor Red
        }
        
        Write-Host ""
        Write-Host "=== STEPS ===" -ForegroundColor Cyan
        $steps = Invoke-RestMethod -Uri "https://api.bitbucket.org/2.0/repositories/$Workspace/$Repository/pipelines/$($latest.uuid)/steps/" -Headers $headers -Method Get
        
        $failedStep = $null

        $steps.values | ForEach-Object {
            $color = "Gray"
            if ($_.state.result.name -eq "SUCCESSFUL") { $color = "Green" }
            if ($_.state.result.name -eq "FAILED") { 
                $color = "Red" 
                $failedStep = $_
            }
            Write-Host "  $($_.name) - $($_.state.result.name) ($($_.duration_in_seconds)s)" -ForegroundColor $color
        }

        # Exibe log caso tenha falhado
        if ($failedStep) {
            Write-Host ""
            Write-Host "=== LOG DA FALHA ($($failedStep.name)) ===" -ForegroundColor Red
            
            $pipeId = $latest.uuid -replace "{","%7B" -replace "}","%7D"
            $stepId = $failedStep.uuid -replace "{","%7B" -replace "}","%7D"
            $logUrl = "https://api.bitbucket.org/2.0/repositories/$Workspace/$Repository/pipelines/$pipeId/steps/$stepId/log"

            try {
                $logRes = Invoke-RestMethod -Uri $logUrl -Headers $headers -Method Get
                $logLines = $logRes -split "`n"
                # Exibe as ultimas 40 linhas do log
                $logLines | Select-Object -Last 40 | ForEach-Object { Write-Host $_ -ForegroundColor Gray }
            } catch {
                Write-Host "Nao foi possivel carregar o log: $($_.Exception.Message)" -ForegroundColor DarkRed
            }
        }
    } else {
        Write-Host "O pipeline ainda esta em execucao. Aguarde e rode novamente." -ForegroundColor Yellow
    }
} catch {
    Write-Host "Erro ao buscar pipeline: $($_.Exception.Message)" -ForegroundColor Red
}
