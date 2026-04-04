$ErrorActionPreference = 'Stop'

function Load-Env([string]$Path) {
  $map = @{}
  if (!(Test-Path $Path)) { return $map }
  Get-Content $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith('#') -or -not $line.Contains('=')) { return }
    $idx = $line.IndexOf('=')
    $k = $line.Substring(0, $idx).Trim()
    $v = $line.Substring($idx + 1).Trim().Trim('"')
    $map[$k] = $v
  }
  return $map
}

$cfg = Load-Env '.env.antigravity.local'
$base = [string]$cfg['NEXT_PUBLIC_SUPABASE_URL']
$base = $base.TrimEnd('/')
$anon = [string]$cfg['NEXT_PUBLIC_SUPABASE_ANON_KEY']

$loginBody = @{ email = 'demo.admin@local.test'; password = 'DemoAdmin123!' } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri "$base/auth/v1/token?grant_type=password" -Headers @{ apikey = $anon; 'Content-Type' = 'application/json' } -Body $loginBody

$token = [string]$login.access_token
Write-Output ("token_ok=" + [bool]$token)

try {
  $resp = Invoke-RestMethod -Method Get -Uri 'http://localhost:3000/api/tenant/memberships/' -Headers @{ Authorization = "Bearer $token" }
  $resp | ConvertTo-Json -Depth 8
}
catch {
  if ($_.Exception.Response) {
    $sr = New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())
    $txt = $sr.ReadToEnd()
    Write-Output ("memberships_error=" + $txt)
  }
  else {
    Write-Output ("memberships_error=" + $_.Exception.Message)
  }
}

