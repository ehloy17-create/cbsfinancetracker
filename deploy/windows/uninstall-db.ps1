$ErrorActionPreference = 'Stop'

function Read-EnvFile {
  param([string]$Path)

  $values = @{}
  if (-not (Test-Path $Path)) {
    return $values
  }

  Get-Content -Path $Path | ForEach-Object {
    if (-not $_ -or $_.Trim().StartsWith('#')) {
      return
    }

    $pair = $_ -split '=', 2
    if ($pair.Count -eq 2) {
      $values[$pair[0].Trim()] = $pair[1]
    }
  }

  return $values
}

function Get-EnvFileCandidates {
  return @(
    (Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'BizTracker\config\app.env'),
    (Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'GCashPOSLocal\config\app.env'),
    (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'GCashPOSLocal\config\app.env')
  ) | Select-Object -Unique
}

$envFile = Get-EnvFileCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
$envMap = if ($envFile) { Read-EnvFile -Path $envFile } else { @{} }
$serviceName = if ($envMap.ContainsKey('DB_SERVICE_NAME')) { $envMap['DB_SERVICE_NAME'] } else { 'BizTrackerMariaDB' }

$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($null -ne $service) {
  if ($service.Status -ne 'Stopped') {
    sc.exe stop $serviceName | Out-Null
    Start-Sleep -Seconds 2
  }
  sc.exe delete $serviceName | Out-Null
}
