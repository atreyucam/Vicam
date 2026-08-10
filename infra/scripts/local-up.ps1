[CmdletBinding()]
param(
  [string]$EnvFile = "infra/env/local.env.example"
)

$ErrorActionPreference = "Stop"
$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$resolvedEnvFile = (Resolve-Path (Join-Path $workspaceRoot $EnvFile)).Path

Push-Location $workspaceRoot
try {
  docker compose --env-file $resolvedEnvFile config --quiet
  & (Join-Path $PSScriptRoot "local-migrate.ps1") -EnvFile $EnvFile
  docker compose --env-file $resolvedEnvFile up --build --detach --wait
  & (Join-Path $PSScriptRoot "local-health.ps1") -EnvFile $EnvFile
}
finally {
  Pop-Location
}
