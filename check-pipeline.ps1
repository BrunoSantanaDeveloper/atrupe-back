$response = Invoke-RestMethod -Uri 'https://api.bitbucket.org/2.0/repositories/tribodev/atrupe-back/pipelines/?sort=-created_on&pagelen=1' -Method Get
$pipeline = $response.values[0]
$branch   = $pipeline.target.ref_name
$status   = $pipeline.state.name
$result   = $pipeline.state.result.name
$buildNum = $pipeline.build_number

Write-Host "=== Bitbucket Pipeline Status ==="
Write-Host "Build #:  $buildNum"
Write-Host "Branch:   $branch"
Write-Host "Status:   $status"
Write-Host "Result:   $result"
