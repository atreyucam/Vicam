[CmdletBinding()]
param(
  [string]$EnvFile = "infra/env/local.env.example"
)

$ErrorActionPreference = "Stop"
$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$resolvedEnvFile = (Resolve-Path (Join-Path $workspaceRoot $EnvFile)).Path

Push-Location $workspaceRoot
try {
  docker compose --env-file $resolvedEnvFile run --rm api node packages/db/dist/seed-cli.js
}
finally {
  Pop-Location
}
