$ErrorActionPreference = 'Stop'

function Load-Env([string]$Path) {
  if (!(Test-Path $Path)) { return @{} }
  $map = @{}
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

$baseUrlRaw = ''
if ($cfg.ContainsKey('NEXT_PUBLIC_SUPABASE_URL')) { $baseUrlRaw = [string]$cfg['NEXT_PUBLIC_SUPABASE_URL'] }
$baseUrl = $baseUrlRaw.TrimEnd('/')

$serviceKey = ''
if ($cfg.ContainsKey('SUPABASE_SERVICE_ROLE_KEY')) { $serviceKey = [string]$cfg['SUPABASE_SERVICE_ROLE_KEY'] }

if ([string]::IsNullOrWhiteSpace($baseUrl) -or [string]::IsNullOrWhiteSpace($serviceKey)) {
  throw 'Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.antigravity.local'
}

$restHeaders = @{
  apikey = $serviceKey
  Authorization = "Bearer $serviceKey"
  'Accept-Profile' = 'platform_core'
}

$authHeaders = @{
  apikey = $serviceKey
  Authorization = "Bearer $serviceKey"
}

$tenantUsersUrl = "$baseUrl/rest/v1/tenant_users?select=user_id,tenant_id,role,is_primary&order=is_primary.desc&limit=200"
$authUsersUrl = "$baseUrl/auth/v1/admin/users?page=1&per_page=200"

$tenantUsersError = $null
$authUsersError = $null

$tenantUsers = @()
try {
  $tenantUsers = @(Invoke-RestMethod -Method GET -Uri $tenantUsersUrl -Headers $restHeaders)
}
catch {
  $tenantUsersError = $_.Exception.Message
}

$authUsers = @()
try {
  $authRes = Invoke-RestMethod -Method GET -Uri $authUsersUrl -Headers $authHeaders
  $authUsers = @($authRes.users)
}
catch {
  $authUsersError = $_.Exception.Message
}

$authIds = @{}
foreach ($u in $authUsers) {
  if ($u.id) { $authIds[[string]$u.id] = $true }
}

$joined = @()
foreach ($r in $tenantUsers) {
  $uid = [string]$r.user_id
  $joined += [PSCustomObject]@{
    user_id = $uid
    tenant_id = [string]$r.tenant_id
    role = [string]$r.role
    is_primary = [bool]$r.is_primary
    auth_user_exists = [bool]$authIds[$uid]
  }
}

$primary = @($joined | Where-Object { $_.is_primary -eq $true -and $_.auth_user_exists -eq $true })

[PSCustomObject]@{
  summary = [PSCustomObject]@{
    tenant_users_count = $tenantUsers.Count
    auth_users_count = $authUsers.Count
    matched_rows = (@($joined | Where-Object { $_.auth_user_exists -eq $true })).Count
    unmatched_rows = (@($joined | Where-Object { $_.auth_user_exists -eq $false })).Count
    primary_usable_rows = $primary.Count
    tenant_users_error = $tenantUsersError
    auth_users_error = $authUsersError
  }
  usable_primary_sample = @($primary | Select-Object -First 10)
  unmatched_sample = @($joined | Where-Object { $_.auth_user_exists -eq $false } | Select-Object -First 10)
} | ConvertTo-Json -Depth 8

