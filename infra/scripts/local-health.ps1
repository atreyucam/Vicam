[CmdletBinding()]
param(
  [string]$EnvFile = "infra/env/local.env.example"
)

$ErrorActionPreference = "Stop"
$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$resolvedEnvFile = (Resolve-Path (Join-Path $workspaceRoot $EnvFile)).Path
$envValues = @{}

Get-Content -LiteralPath $resolvedEnvFile | ForEach-Object {
  if ($_ -match '^\s*([^#][^=]*)=(.*)$') {
    $envValues[$matches[1].Trim()] = $matches[2].Trim()
  }
}

$httpPort = if ($envValues.ContainsKey("VICAM_HTTP_PORT")) {
  $envValues["VICAM_HTTP_PORT"]
} else {
  "8080"
}
$baseUri = "http://127.0.0.1:$httpPort"
$checks = @(
  "$baseUri/health/live",
  "$baseUri/api/v1/health/live",
  "$baseUri/api/v1/health/ready"
)

foreach ($uri in $checks) {
  $response = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 10
  if ($response.StatusCode -ne 200) {
    throw "Health check falló para $uri con HTTP $($response.StatusCode)."
  }
  Write-Host "OK $uri"
}

