param(
  [string]$AppRoot = $PSScriptRoot
)

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

function Show-StartupError {
  param([string]$Message)

  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($Message, 'BizTracker') | Out-Null
}

function Test-IsPrivateIPv4 {
  param([string]$Address)

  $match = [regex]::Match($Address, '^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$')
  if (-not $match.Success) {
    return $false
  }

  $octets = @(
    [int]$match.Groups[1].Value
    [int]$match.Groups[2].Value
    [int]$match.Groups[3].Value
    [int]$match.Groups[4].Value
  )

  if ($octets | Where-Object { $_ -lt 0 -or $_ -gt 255 }) {
    return $false
  }

  return $octets[0] -eq 10 `
    -or ($octets[0] -eq 172 -and $octets[1] -ge 16 -and $octets[1] -le 31) `
    -or ($octets[0] -eq 192 -and $octets[1] -eq 168)
}

function Get-PreferredLanAddress {
  $addresses = @()

  try {
    $addresses += Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
      Where-Object {
        $_.IPAddress -and
        $_.IPAddress -ne '127.0.0.1' -and
        $_.ValidLifetime -ne ([TimeSpan]::Zero)
      } |
      Select-Object -ExpandProperty IPAddress
  } catch {
  }

  if ($addresses.Count -eq 0) {
    try {
      $addresses += [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) |
        Where-Object { $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork } |
        ForEach-Object { $_.IPAddressToString }
    } catch {
    }
  }

  return $addresses |
    Where-Object { Test-IsPrivateIPv4 -Address $_ } |
    Select-Object -Unique -First 1
}

function Write-EventLog {
  param(
    [string]$EventName,
    [hashtable]$Details = @{},
    [string]$Source = 'launcher'
  )

  $targetLogsDir = if ($script:logsDir) {
    $script:logsDir
  } else {
    Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'BizTracker\logs'
  }

  New-Item -ItemType Directory -Path $targetLogsDir -Force | Out-Null
  $eventLogPath = Join-Path $targetLogsDir 'events.log'
  $payload = ''

  if ($Details.Count -gt 0) {
    try {
      $payload = ' ' + ($Details | ConvertTo-Json -Compress -Depth 8)
    } catch {
      $payload = ' {"serialization_error":"Failed to serialize event details"}'
    }
  }

  Add-Content -Path $eventLogPath -Value ("{0} [{1}] {2}{3}" -f ((Get-Date).ToString('o')), $Source, $EventName, $payload)
}

function Stop-StaleApiProcess {
  param(
    [int]$Port,
    [string]$InstallRoot = ''
  )

  $stopped = $false

  try {
    $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    foreach ($listener in $listeners) {
      $processId = [int]$listener.OwningProcess
      if ($processId -le 0) { continue }

      $procInfo = Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $processId) -ErrorAction SilentlyContinue
      $isBizTrackerProcess = $false

      if ($procInfo) {
        $exePath = [string]$procInfo.ExecutablePath
        $commandLine = [string]$procInfo.CommandLine
        if (
          ($InstallRoot -and $exePath -and $exePath -like "$InstallRoot*") -or
          ($commandLine -and ($commandLine -like '*server\index.js*' -or $commandLine -like '*run-api.cmd*'))
        ) {
          $isBizTrackerProcess = $true
        }
      }

      if ($isBizTrackerProcess) {
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
        $stopped = $true
      }
    }
  } catch {
  }

  return $stopped
}

function Get-AppDataCandidates {
  return @(
    (Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'BizTracker'),
    (Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'GCashPOSLocal'),
    (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'GCashPOSLocal')
  ) | Select-Object -Unique
}

function Get-ServiceAppDataDir {
  $serviceNames = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  $null = $serviceNames.Add('GCashPosLocalMariaDB')
  $null = $serviceNames.Add('BizTrackerMariaDB')

  foreach ($candidate in Get-AppDataCandidates) {
    $candidateEnvFile = Join-Path $candidate 'config\app.env'
    if (Test-Path $candidateEnvFile) {
      $envMap = Read-EnvFile -Path $candidateEnvFile
      if ($envMap.ContainsKey('DB_SERVICE_NAME') -and -not [string]::IsNullOrWhiteSpace($envMap['DB_SERVICE_NAME'])) {
        $null = $serviceNames.Add($envMap['DB_SERVICE_NAME'].Trim())
      }
    }
  }

  foreach ($serviceName in $serviceNames) {
    try {
      $serviceOutput = & sc.exe qc $serviceName 2>$null | Out-String
      $match = [regex]::Match($serviceOutput, '--defaults-file=([^\r\n"]+|"[^"]+")')
      if (-not $match.Success) {
        continue
      }

      $defaultsFile = $match.Groups[1].Value.Trim().Trim('"')
      if (-not (Test-Path $defaultsFile)) {
        continue
      }

      return Split-Path -Parent (Split-Path -Parent $defaultsFile)
    } catch {
    }
  }

  return $null
}

function Get-InitializedRuntime {
  $serviceAppDataDir = Get-ServiceAppDataDir
  if ($serviceAppDataDir) {
    $serviceEnvFile = Join-Path $serviceAppDataDir 'config\app.env'
    if (Test-Path $serviceEnvFile) {
      return @{
        AppDataDir = $serviceAppDataDir
        EnvFile = $serviceEnvFile
      }
    }
  }

  foreach ($candidate in Get-AppDataCandidates) {
    $candidateEnvFile = Join-Path $candidate 'config\app.env'
    $candidateDataDir = Join-Path $candidate 'mariadb-data'
    if ((Test-Path $candidateEnvFile) -and (Test-Path $candidateDataDir) -and (Get-ChildItem -Path $candidateDataDir -Force -ErrorAction SilentlyContinue | Select-Object -First 1)) {
      return @{
        AppDataDir = $candidate
        EnvFile = $candidateEnvFile
      }
    }
  }

  foreach ($candidate in Get-AppDataCandidates) {
    $candidateEnvFile = Join-Path $candidate 'config\app.env'
    if (Test-Path $candidateEnvFile) {
      return @{
        AppDataDir = $candidate
        EnvFile = $candidateEnvFile
      }
    }
  }

  return $null
}

function Invoke-AppInitialization {
  $installScript = Join-Path $AppRoot 'install-db.ps1'
  if (-not (Test-Path $installScript)) {
    throw "Initialization script is missing: $installScript"
  }

  $argumentList = @(
    '-NoProfile'
    '-ExecutionPolicy Bypass'
    ('-File "{0}"' -f $installScript)
    ('-AppDir "{0}"' -f $AppRoot)
  )

  try {
    $process = Start-Process -FilePath 'powershell.exe' -Verb RunAs -WorkingDirectory $AppRoot -Wait -PassThru -ArgumentList ($argumentList -join ' ')
  } catch {
    throw 'Initialization was canceled before it could complete.'
  }

  if ($process.ExitCode -ne 0) {
    throw "Initialization failed with exit code $($process.ExitCode)."
  }
}

try {
  Write-EventLog -EventName 'launcher.start' -Details @{ AppRoot = $AppRoot }
  $runtime = Get-InitializedRuntime
  if (-not $runtime) {
    Write-EventLog -EventName 'launcher.init.required'
    Invoke-AppInitialization
    $runtime = Get-InitializedRuntime
    if ($runtime) {
      Write-EventLog -EventName 'launcher.init.complete' -Details @{ AppDataDir = $runtime.AppDataDir }
    }
  }

  if (-not $runtime) {
    Write-EventLog -EventName 'launcher.init.missing'
    Show-StartupError "The application could not finish initialization.`n`nPlease check the setup window for errors and try again."
    exit 1
  }

  $appDataDir = $runtime.AppDataDir
  $script:logsDir = Join-Path $appDataDir 'logs'
  $envFile = $runtime.EnvFile
  $envMap = Read-EnvFile -Path $envFile
  $storedApiPort = if ($envMap.ContainsKey('API_PORT')) { [string]$envMap['API_PORT'] } else { '' }
  $apiPort = if (-not [string]::IsNullOrWhiteSpace($storedApiPort) -and $storedApiPort.Trim() -ne '4000') { $storedApiPort.Trim() } else { '4010' }
  if ($storedApiPort -ne $apiPort) {
    try {
      $envLines = if (Test-Path $envFile) { Get-Content -Path $envFile } else { @() }
      $updated = $false
      $rewritten = foreach ($line in $envLines) {
        if ($line -match '^API_PORT=') {
          $updated = $true
          "API_PORT=$apiPort"
        } else {
          $line
        }
      }
      if (-not $updated) {
        $rewritten += "API_PORT=$apiPort"
      }
      Set-Content -Path $envFile -Value $rewritten -Encoding ASCII
      Write-EventLog -EventName 'config.api_port.normalized' -Details @{ PreviousPort = $storedApiPort; NewPort = $apiPort; EnvFile = $envFile }
    } catch {
    }
  }
  $dbServiceName = if ($envMap.ContainsKey('DB_SERVICE_NAME')) { $envMap['DB_SERVICE_NAME'] } else { 'BizTrackerMariaDB' }
  $loopbackApiBase = "http://127.0.0.1:$apiPort"
  $publicBaseOverride = if ($envMap.ContainsKey('APP_PUBLIC_BASE_URL')) { $envMap['APP_PUBLIC_BASE_URL'].Trim() } else { '' }
  $lanAddress = Get-PreferredLanAddress
  $lanApiBase = if ($publicBaseOverride) {
    $publicBaseOverride.TrimEnd('/')
  } elseif ($lanAddress) {
    ("http://{0}:{1}" -f $lanAddress, $apiPort)
  } else {
    $loopbackApiBase
  }

  # Always open the local browser on loopback so startup does not depend on
  # the current LAN address, Wi-Fi state, or firewall handling of the host IP.
  # The server still binds for LAN access; other devices can use $lanApiBase.
  $launchUrl = $loopbackApiBase
  $logsDir = $script:logsDir
  if (-not (Test-Path $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
  }
  Write-EventLog -EventName 'launcher.runtime.ready' -Details @{
    AppDataDir = $appDataDir
    LocalApiBase = $loopbackApiBase
    LanApiBase = $lanApiBase
    DbServiceName = $dbServiceName
  }

  try {
    $service = Get-Service -Name $dbServiceName -ErrorAction Stop
    if ($service.Status -ne 'Running') {
      Write-EventLog -EventName 'mariadb.service.starting' -Details @{ ServiceName = $dbServiceName }
      Start-Service -Name $dbServiceName
    }
  } catch {
    Write-EventLog -EventName 'mariadb.service.repair_required' -Details @{ ServiceName = $dbServiceName; Error = $_.Exception.Message }
    Invoke-AppInitialization
    $service = Get-Service -Name $dbServiceName -ErrorAction SilentlyContinue
    if ($null -eq $service) {
      Write-EventLog -EventName 'mariadb.service.missing' -Details @{ ServiceName = $dbServiceName }
      Show-StartupError "The local MariaDB service '$dbServiceName' could not be installed.`n`nRun the setup repair again and check the on-screen error details."
      exit 1
    }

    if ($service.Status -ne 'Running') {
      Write-EventLog -EventName 'mariadb.service.starting' -Details @{ ServiceName = $dbServiceName }
      Start-Service -Name $dbServiceName
    }
  }
  Write-EventLog -EventName 'mariadb.service.ready' -Details @{ ServiceName = $dbServiceName }

  try {
    Invoke-WebRequest -Uri "$loopbackApiBase/health" -UseBasicParsing -TimeoutSec 2 | Out-Null
    Write-EventLog -EventName 'api.health.ready' -Details @{ ApiBase = $loopbackApiBase; LaunchUrl = $launchUrl }
  } catch {
    Write-EventLog -EventName 'api.health.missing' -Details @{ ApiBase = $loopbackApiBase }
    $staleStopped = Stop-StaleApiProcess -Port ([int]$apiPort) -InstallRoot $AppRoot
    if ($staleStopped) {
      Write-EventLog -EventName 'api.stale_process.stopped' -Details @{ ApiBase = $loopbackApiBase; Port = $apiPort }
    }
    $runApiCmd = Join-Path $AppRoot 'run-api.cmd'
    $cmdCommand = ('set "APP_DATA_DIR={0}" && set "APP_ENV_FILE={1}" && set "APP_LOGS_DIR={2}" && set "NODE_ENV=production" && call "{3}"' -f $appDataDir, $envFile, $logsDir, $runApiCmd)
    Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', $cmdCommand) -WorkingDirectory $AppRoot -WindowStyle Hidden
    Write-EventLog -EventName 'api.start.requested' -Details @{ Command = $runApiCmd; AppDataDir = $appDataDir }

    $deadline = (Get-Date).AddSeconds(30)
    $started = $false
    while ((Get-Date) -lt $deadline) {
      Start-Sleep -Seconds 1
      try {
        Invoke-WebRequest -Uri "$loopbackApiBase/health" -UseBasicParsing -TimeoutSec 2 | Out-Null
        $started = $true
        break
      } catch {
      }
    }

    if (-not $started) {
      Write-EventLog -EventName 'api.start.timeout' -Details @{ ApiBase = $loopbackApiBase; LogsDir = $logsDir }
      Show-StartupError "The local application server did not become ready in time.`n`nCheck $logsDir for details."
      exit 1
    }

    Write-EventLog -EventName 'api.health.ready' -Details @{ ApiBase = $loopbackApiBase; LaunchUrl = $launchUrl }
  }

  Write-EventLog -EventName 'browser.launch' -Details @{ Url = $launchUrl }
  Start-Process $launchUrl
} catch {
  Write-EventLog -EventName 'launcher.error' -Details @{ Message = $_.Exception.Message }
  Show-StartupError $_.Exception.Message
  exit 1
}
