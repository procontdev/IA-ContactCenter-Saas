param(
  [string]$TenantId = '00000000-0000-0000-0000-000000000001',
  [string]$FromPe = '2026-03-30 00:00:00',
  [string]$ToPe = '2026-03-31 23:59:59',
  [string]$SupabaseUrl = '',
  [string]$ApiBaseUrl = 'http://localhost:3001',
  [string]$ApiKey = '',
  [switch]$Json
)

$ErrorActionPreference = 'Stop'

$scriptPath = Join-Path $PSScriptRoot 'smoke-dashboard.js'
if (!(Test-Path $scriptPath)) {
  throw "No existe el script Node: $scriptPath"
}

$nodeVersion = & node --version 2>$null
if (-not $nodeVersion) {
  throw 'Node.js no está disponible en PATH.'
}

$argsList = @(
  $scriptPath,
  '--tenantId', $TenantId,
  '--fromPe', $FromPe,
  '--toPe', $ToPe,
  '--apiBaseUrl', $ApiBaseUrl
)

if ($SupabaseUrl -and $SupabaseUrl.Trim()) {
  $argsList += @('--supabaseUrl', $SupabaseUrl)
}

if ($ApiKey -and $ApiKey.Trim()) {
  $argsList += @('--apiKey', $ApiKey)
}

if ($Json.IsPresent) {
  $argsList += '--json'
}

& node @argsList
$exitCode = $LASTEXITCODE

if ($exitCode -ne 0) {
  exit $exitCode
}
