param(
  [Parameter(Mandatory = $true)]
  [string]$AppDir
)

$ErrorActionPreference = 'Stop'
$CurrentAppDataName = 'BizTracker'
$LegacyAppDataName = 'GCashPOSLocal'
$DefaultDbServiceName = 'BizTrackerMariaDB'

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Restart-Elevated {
  $argumentList = @(
    '-NoProfile'
    '-ExecutionPolicy Bypass'
    ('-File "{0}"' -f $PSCommandPath)
    ('-AppDir "{0}"' -f $AppDir)
  )

  try {
    $process = Start-Process -FilePath 'powershell.exe' -Verb RunAs -WorkingDirectory $AppDir -ArgumentList ($argumentList -join ' ') -Wait -PassThru
  } catch {
    throw 'BizTracker setup needs Administrator permission. Approve the Windows UAC prompt, or run the installer as administrator.'
  }

  exit $process.ExitCode
}

function New-RandomHex {
  param([int]$ByteCount = 24)

  $bytes = New-Object byte[] $ByteCount
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    if ($null -ne $rng) {
      $rng.Dispose()
    }
  }

  return ([System.BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant())
}

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

function Write-EnvFile {
  param(
    [string]$Path,
    [hashtable]$Values
  )

  $lines = @(
    "APP_MODE=production",
    "API_HOST=$($Values.API_HOST)",
    "API_PORT=$($Values.API_PORT)",
    "APP_PUBLIC_BASE_URL=$($Values.APP_PUBLIC_BASE_URL)",
    "VITE_APP_URL=$($Values.VITE_APP_URL)",
    "DB_HOST=$($Values.DB_HOST)",
    "DB_PORT=$($Values.DB_PORT)",
    "DB_USER=$($Values.DB_USER)",
    "DB_PASSWORD=$($Values.DB_PASSWORD)",
    "DB_NAME=$($Values.DB_NAME)",
    "DB_SERVICE_NAME=$($Values.DB_SERVICE_NAME)",
    "JWT_SECRET=$($Values.JWT_SECRET)",
    "ADMIN_NAME=$($Values.ADMIN_NAME)",
    "ADMIN_EMAIL=$($Values.ADMIN_EMAIL)",
    "ADMIN_PASSWORD=$($Values.ADMIN_PASSWORD)"
  )

  Set-Content -Path $Path -Value $lines -Encoding ASCII
}

function Normalize-ApiHost {
  param([string]$Value)

  $trimmed = ''
  if (-not [string]::IsNullOrWhiteSpace($Value)) {
    $trimmed = $Value.Trim()
  }

  if (-not $trimmed) {
    return '::'
  }

  $normalized = $trimmed.ToLowerInvariant()
  # Loopback-only and legacy IPv4 wildcard addresses are migrated to :: so the
  # server uses a dual-stack socket and accepts both IPv4 (127.0.0.1, LAN IPs)
  # and IPv6 (::1, which is what modern Chrome resolves 'localhost' to on Windows)
  if ($normalized -eq '127.0.0.1' -or $normalized -eq 'localhost' -or
      $normalized -eq '::1'       -or $normalized -eq '0.0.0.0') {
    return '::'
  }

  return $trimmed
}

function Normalize-AppBaseUrl {
  param([string]$Value)

  $trimmed = ''
  if (-not [string]::IsNullOrWhiteSpace($Value)) {
    $trimmed = $Value.Trim()
  }

  if (-not $trimmed) {
    return ''
  }

  try {
    $uri = [System.Uri]$trimmed
    $uriHost = $uri.Host.ToLowerInvariant()
    if ($uriHost -eq '127.0.0.1' -or $uriHost -eq 'localhost' -or $uriHost -eq '::1') {
      return ''
    }
    return $trimmed.TrimEnd('/')
  } catch {
    return $trimmed.TrimEnd('/')
  }
}

function Get-SharedAppDataDir {
  return Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) $CurrentAppDataName
}

function Get-LegacyAppDataDir {
  return Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) $LegacyAppDataName
}

function Get-LegacyUserAppDataDir {
  return Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) $LegacyAppDataName
}

function Get-ServiceAppDataDir {
  param([string[]]$CandidateServiceNames)

  foreach ($serviceName in ($CandidateServiceNames | Where-Object { $_ } | Select-Object -Unique)) {
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

function Resolve-PreferredAppDataDir {
  param([string[]]$CandidateServiceNames)

  $serviceAppDataDir = Get-ServiceAppDataDir -CandidateServiceNames $CandidateServiceNames
  if ($serviceAppDataDir) {
    return $serviceAppDataDir
  }

  $candidates = @(
    (Get-SharedAppDataDir),
    (Get-LegacyAppDataDir),
    (Get-LegacyUserAppDataDir)
  ) | Where-Object { $_ } | Select-Object -Unique

  foreach ($candidate in $candidates) {
    $candidateEnvFile = Join-Path $candidate 'config\app.env'
    $candidateDataDir = Join-Path $candidate 'mariadb-data'
    if ((Test-Path $candidateEnvFile) -and (Test-Path $candidateDataDir) -and (Get-ChildItem -Path $candidateDataDir -Force -ErrorAction SilentlyContinue | Select-Object -First 1)) {
      return $candidate
    }
  }

  foreach ($candidate in $candidates) {
    $candidateEnvFile = Join-Path $candidate 'config\app.env'
    if (Test-Path $candidateEnvFile) {
      return $candidate
    }
  }

  return Get-SharedAppDataDir
}

function Write-EventLog {
  param(
    [string]$EventName,
    [hashtable]$Details = @{},
    [string]$Source = 'installer'
  )

  $targetLogsDir = if ($script:logsDir) {
    $script:logsDir
  } else {
    Join-Path (Get-SharedAppDataDir) 'logs'
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

function Grant-AppDataAccess {
  param([string]$Path)

  $usersSid = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-545')
  $usersGroup = $usersSid.Translate([System.Security.Principal.NTAccount])
  $acl = Get-Acl -Path $Path
  $inheritanceFlags = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
  $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
    $usersGroup,
    [System.Security.AccessControl.FileSystemRights]::Modify,
    $inheritanceFlags,
    [System.Security.AccessControl.PropagationFlags]::None,
    [System.Security.AccessControl.AccessControlType]::Allow
  )

  $acl.SetAccessRule($rule)
  Set-Acl -Path $Path -AclObject $acl
}

function Test-TcpPortInUse {
  param([int]$Port)

  $listeners = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
  return $null -ne ($listeners | Where-Object { $_.Port -eq $Port } | Select-Object -First 1)
}

function Wait-ForTcpPort {
  param(
    [int]$Port,
    [int]$TimeoutSeconds = 45
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-TcpPortInUse -Port $Port) {
      return $true
    }
    Start-Sleep -Milliseconds 500
  }

  return $false
}

function Get-AvailableTcpPort {
  param(
    [int]$PreferredPort,
    [int]$MaxAttempts = 25
  )

  for ($offset = 0; $offset -lt $MaxAttempts; $offset++) {
    $candidate = $PreferredPort + $offset
    if (-not (Test-TcpPortInUse -Port $candidate)) {
      return [string]$candidate
    }
  }

  throw "Could not find an available TCP port starting at $PreferredPort."
}

function Invoke-LoggedProcess {
  param(
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$StdOutPath,
    [string]$StdErrPath
  )

  if (Test-Path $StdOutPath) { Remove-Item $StdOutPath -Force }
  if (Test-Path $StdErrPath) { Remove-Item $StdErrPath -Force }

  $quotedArgs = $Arguments | ForEach-Object { if ($_ -match ' ') { '"{0}"' -f $_ } else { $_ } }
  $process = Start-Process -FilePath $FilePath -ArgumentList $quotedArgs -Wait -PassThru -WindowStyle Hidden -RedirectStandardOutput $StdOutPath -RedirectStandardError $StdErrPath
  return $process.ExitCode
}

function Get-MariaDbServiceInstallError {
  param(
    [int]$ExitCode,
    [string]$StdOutPath,
    [string]$StdErrPath,
    [string]$Action
  )

  $tail = @(
    Get-LogTail -Path $StdErrPath -LineCount 20
    Get-LogTail -Path $StdOutPath -LineCount 20
  ) | Where-Object { $_ }

  $detail = if ($tail.Count -gt 0) {
    "`n`nRecent MariaDB output:`n" + ($tail -join "`n")
  } else {
    ''
  }

  return "MariaDB $Action failed with exit code $ExitCode.`nSee $StdErrPath and $StdOutPath for details.$detail"
}

function Repair-MariaDbService {
  param(
    [string]$MariaServerExe,
    [string]$ServiceName,
    [string]$DataDir,
    [string]$Port,
    [string]$StdOutPath,
    [string]$StdErrPath
  )

  Write-EventLog -EventName 'mariadb.service.repair.start' -Details @{
    ServiceName = $ServiceName
    DataDir = $DataDir
    Port = $Port
    ServerExe = $MariaServerExe
  }

  $repairExitCode = Invoke-LoggedProcess -FilePath $MariaServerExe -Arguments @(
    '--install',
    $ServiceName,
    "--datadir=$DataDir",
    "--port=$Port"
  ) -StdOutPath $StdOutPath -StdErrPath $StdErrPath

  if ($repairExitCode -ne 0) {
    Write-EventLog -EventName 'mariadb.service.repair.failed' -Details @{
      ExitCode = $repairExitCode
      ServiceName = $ServiceName
      StdOutLog = $StdOutPath
      StdErrLog = $StdErrPath
    }
    throw (Get-MariaDbServiceInstallError -ExitCode $repairExitCode -StdOutPath $StdOutPath -StdErrPath $StdErrPath -Action 'service repair')
  }

  Write-EventLog -EventName 'mariadb.service.repair.ready' -Details @{ ServiceName = $ServiceName; DataDir = $DataDir; Port = $Port }
}

function Get-LogTail {
  param(
    [string]$Path,
    [int]$LineCount = 20
  )

  if (-not (Test-Path $Path)) {
    return @()
  }

  return @(Get-Content -Path $Path -Tail $LineCount -ErrorAction SilentlyContinue)
}

function Ensure-AppFirewallRule {
  param(
    [string]$RuleName,
    [string]$Port
  )

  $newRuleCommand = Get-Command -Name New-NetFirewallRule -ErrorAction SilentlyContinue
  $removeRuleCommand = Get-Command -Name Remove-NetFirewallRule -ErrorAction SilentlyContinue
  $getRuleCommand = Get-Command -Name Get-NetFirewallRule -ErrorAction SilentlyContinue

  if (-not $newRuleCommand -or -not $removeRuleCommand -or -not $getRuleCommand) {
    Write-EventLog -EventName 'firewall.rule.skipped' -Details @{
      RuleName = $RuleName
      Port = $Port
      Reason = 'NetSecurity module unavailable'
    }
    return
  }

  Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule `
    -DisplayName $RuleName `
    -Direction Inbound `
    -Action Allow `
    -Enabled True `
    -Profile Domain,Private `
    -Protocol TCP `
    -LocalPort $Port `
    -RemoteAddress LocalSubnet `
    -Description 'Allows BizTracker app access from the local subnet on private/domain networks.' | Out-Null

  Write-EventLog -EventName 'firewall.rule.ready' -Details @{
    RuleName = $RuleName
    Port = $Port
    Profiles = 'Domain,Private'
    RemoteAddress = 'LocalSubnet'
  }
}

function Test-DirectoryHasContent {
  param([string]$Path)

  return $null -ne (Get-ChildItem -Path $Path -Force -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Test-SetupCompleted {
  param([string]$LogsDir)

  $eventLogPath = Join-Path $LogsDir 'events.log'
  if (-not (Test-Path $eventLogPath)) {
    return $false
  }

  return $null -ne (Select-String -Path $eventLogPath -Pattern 'runtime\.init\.ready' -SimpleMatch:$false -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Clear-DirectoryContents {
  param([string]$Path)

  Get-ChildItem -Path $Path -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
}

if (-not (Test-IsAdministrator)) {
  Restart-Elevated
}

$legacyAppDataDir = Get-LegacyAppDataDir
$legacyUserAppDataDir = Get-LegacyUserAppDataDir
$appDataDir = Resolve-PreferredAppDataDir -CandidateServiceNames @($DefaultDbServiceName, 'GCashPosLocalMariaDB')
$configDir = Join-Path $appDataDir 'config'
$logsDir = Join-Path $AppDir 'logs'
$dbDataDir = Join-Path $appDataDir 'mariadb-data'
$envFile = Join-Path $configDir 'app.env'
$legacyEnvFile = Join-Path $legacyAppDataDir 'config\app.env'
$legacyUserEnvFile = Join-Path $legacyUserAppDataDir 'config\app.env'

New-Item -ItemType Directory -Path $appDataDir -Force | Out-Null
New-Item -ItemType Directory -Path $configDir -Force | Out-Null
New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
New-Item -ItemType Directory -Path $dbDataDir -Force | Out-Null
Grant-AppDataAccess -Path $appDataDir
Grant-AppDataAccess -Path $logsDir
Write-EventLog -EventName 'setup.begin' -Details @{
  AppDir = $AppDir
  AppDataDir = $appDataDir
  LogsDir = $logsDir
}

if ((-not (Test-Path $envFile)) -and (Test-Path $legacyEnvFile)) {
  Copy-Item -Path $legacyEnvFile -Destination $envFile
  Write-EventLog -EventName 'config.migrated' -Details @{ Source = $legacyEnvFile; Destination = $envFile }
} elseif ((-not (Test-Path $envFile)) -and (Test-Path $legacyUserEnvFile)) {
  Copy-Item -Path $legacyUserEnvFile -Destination $envFile
  Write-EventLog -EventName 'config.migrated' -Details @{ Source = $legacyUserEnvFile; Destination = $envFile }
}

$configCreated = $false
if (-not (Test-Path $envFile)) {
  Write-EnvFile -Path $envFile -Values @{
    API_HOST = '::'
    API_PORT = '4010'
    APP_PUBLIC_BASE_URL = ''
    VITE_APP_URL = ''
    DB_HOST = '127.0.0.1'
    DB_PORT = '3307'
    DB_USER = 'root'
    DB_PASSWORD = (New-RandomHex -ByteCount 18)
    DB_NAME = 'gcash_pos'
    DB_SERVICE_NAME = $DefaultDbServiceName
    JWT_SECRET = (New-RandomHex -ByteCount 32)
    ADMIN_NAME = 'Administrator'
    ADMIN_EMAIL = 'admin@example.com'
    ADMIN_PASSWORD = 'admin123'
  }
  $configCreated = $true
  Write-EventLog -EventName 'config.created' -Details @{ EnvFile = $envFile }
}

$envMap = Read-EnvFile -Path $envFile
$normalizedEnvMap = @{
  API_HOST = Normalize-ApiHost -Value $(if ($envMap.ContainsKey('API_HOST')) { $envMap['API_HOST'] } else { '' })
  API_PORT = if ($envMap.ContainsKey('API_PORT') -and -not [string]::IsNullOrWhiteSpace($envMap['API_PORT'])) {
    $candidatePort = [string]$envMap['API_PORT']
    if ($candidatePort.Trim() -eq '4000') { '4010' } else { $candidatePort.Trim() }
  } else { '4010' }
  APP_PUBLIC_BASE_URL = Normalize-AppBaseUrl -Value $(if ($envMap.ContainsKey('APP_PUBLIC_BASE_URL')) { $envMap['APP_PUBLIC_BASE_URL'] } else { '' })
  VITE_APP_URL = Normalize-AppBaseUrl -Value $(if ($envMap.ContainsKey('VITE_APP_URL')) { $envMap['VITE_APP_URL'] } else { '' })
  DB_HOST = if ($envMap.ContainsKey('DB_HOST') -and -not [string]::IsNullOrWhiteSpace($envMap['DB_HOST'])) { $envMap['DB_HOST'] } else { '127.0.0.1' }
  DB_PORT = if ($envMap.ContainsKey('DB_PORT') -and -not [string]::IsNullOrWhiteSpace($envMap['DB_PORT'])) { $envMap['DB_PORT'] } else { '3307' }
  DB_USER = if ($envMap.ContainsKey('DB_USER') -and -not [string]::IsNullOrWhiteSpace($envMap['DB_USER'])) { $envMap['DB_USER'] } else { 'root' }
  DB_PASSWORD = if ($envMap.ContainsKey('DB_PASSWORD') -and -not [string]::IsNullOrWhiteSpace($envMap['DB_PASSWORD'])) { $envMap['DB_PASSWORD'] } else { (New-RandomHex -ByteCount 18) }
  DB_NAME = if ($envMap.ContainsKey('DB_NAME') -and -not [string]::IsNullOrWhiteSpace($envMap['DB_NAME'])) { $envMap['DB_NAME'] } else { 'gcash_pos' }
  DB_SERVICE_NAME = if ($envMap.ContainsKey('DB_SERVICE_NAME') -and -not [string]::IsNullOrWhiteSpace($envMap['DB_SERVICE_NAME'])) { $envMap['DB_SERVICE_NAME'] } else { $DefaultDbServiceName }
  JWT_SECRET = if ($envMap.ContainsKey('JWT_SECRET') -and -not [string]::IsNullOrWhiteSpace($envMap['JWT_SECRET'])) { $envMap['JWT_SECRET'] } else { (New-RandomHex -ByteCount 32) }
  ADMIN_NAME = if ($envMap.ContainsKey('ADMIN_NAME') -and -not [string]::IsNullOrWhiteSpace($envMap['ADMIN_NAME'])) { $envMap['ADMIN_NAME'] } else { 'Administrator' }
  ADMIN_EMAIL = if ($envMap.ContainsKey('ADMIN_EMAIL') -and -not [string]::IsNullOrWhiteSpace($envMap['ADMIN_EMAIL'])) { $envMap['ADMIN_EMAIL'] } else { 'admin@example.com' }
  ADMIN_PASSWORD = if ($envMap.ContainsKey('ADMIN_PASSWORD') -and -not [string]::IsNullOrWhiteSpace($envMap['ADMIN_PASSWORD'])) { $envMap['ADMIN_PASSWORD'] } else { 'admin123' }
}

Write-EnvFile -Path $envFile -Values $normalizedEnvMap
if (-not $configCreated) {
  Write-EventLog -EventName 'config.normalized' -Details @{
    EnvFile = $envFile
    API_HOST = $normalizedEnvMap.API_HOST
    APP_PUBLIC_BASE_URL = $normalizedEnvMap.APP_PUBLIC_BASE_URL
  }
}

$envMap = Read-EnvFile -Path $envFile
$serviceName = if ($envMap.ContainsKey('DB_SERVICE_NAME')) { $envMap['DB_SERVICE_NAME'] } else { $DefaultDbServiceName }
$apiPort = if ($envMap.ContainsKey('API_PORT')) { $envMap['API_PORT'] } else { '4010' }
$dbPort = if ($envMap.ContainsKey('DB_PORT')) { $envMap['DB_PORT'] } else { '3307' }
$dbPassword = if ($envMap.ContainsKey('DB_PASSWORD')) { $envMap['DB_PASSWORD'] } else { throw 'DB_PASSWORD missing from app.env' }
$mariaInstallExe = Join-Path $AppDir 'vendor\mariadb\bin\mariadb-install-db.exe'
$mariaServerExe = @(
  (Join-Path $AppDir 'vendor\mariadb\bin\mariadbd.exe')
  (Join-Path $AppDir 'vendor\mariadb\bin\mysqld.exe')
) | Where-Object { Test-Path $_ } | Select-Object -First 1
$nodeExe = Join-Path $AppDir 'vendor\node\node.exe'
$initRuntimeScript = Join-Path $AppDir 'server\init-runtime.js'
$mariaStdOutLog = Join-Path $logsDir 'mariadb-install.stdout.log'
$mariaStdErrLog = Join-Path $logsDir 'mariadb-install.stderr.log'
$runtimeStdOutLog = Join-Path $logsDir 'runtime-init.stdout.log'
$runtimeStdErrLog = Join-Path $logsDir 'runtime-init.stderr.log'

$requestedApiPort = [int]$apiPort
if (Test-TcpPortInUse -Port $requestedApiPort) {
  $resolvedApiPort = Get-AvailableTcpPort -PreferredPort ($requestedApiPort + 1)
  Write-EventLog -EventName 'api.port_conflict' -Details @{
    Port = $apiPort
    ResolvedPort = $resolvedApiPort
    EnvFile = $envFile
  }

  $normalizedEnvMap['API_PORT'] = $resolvedApiPort
  Write-EnvFile -Path $envFile -Values $normalizedEnvMap
  $envMap = Read-EnvFile -Path $envFile
  $apiPort = $resolvedApiPort

  Write-EventLog -EventName 'api.port_reassigned' -Details @{
    PreviousPort = $requestedApiPort
    NewPort = $apiPort
  }
}

if (-not (Test-Path $mariaInstallExe)) {
  throw "MariaDB runtime is missing: $mariaInstallExe"
}

if (-not $mariaServerExe) {
  throw "MariaDB server runtime is missing in $AppDir\vendor\mariadb\bin"
}

if (-not (Test-Path $nodeExe)) {
  throw "Node runtime is missing: $nodeExe"
}

Ensure-AppFirewallRule -RuleName 'BizTracker API (LAN)' -Port $apiPort

$serviceExists = $null -ne (Get-Service -Name $serviceName -ErrorAction SilentlyContinue)
if (-not $serviceExists) {
  $requestedDbPort = [int]$dbPort
  if (Test-TcpPortInUse -Port $requestedDbPort) {
    $resolvedDbPort = Get-AvailableTcpPort -PreferredPort ($requestedDbPort + 1)
    Write-EventLog -EventName 'mariadb.port_conflict' -Details @{
      Port = $dbPort
      ResolvedPort = $resolvedDbPort
      EnvFile = $envFile
    }

    $normalizedEnvMap['DB_PORT'] = $resolvedDbPort
    Write-EnvFile -Path $envFile -Values $normalizedEnvMap
    $envMap = Read-EnvFile -Path $envFile
    $dbPort = $resolvedDbPort

    Write-EventLog -EventName 'mariadb.port_reassigned' -Details @{
      PreviousPort = $requestedDbPort
      NewPort = $dbPort
      ServiceName = $serviceName
    }
  }

  if (Test-DirectoryHasContent -Path $dbDataDir) {
    if (Test-SetupCompleted -LogsDir $logsDir) {
      Write-EventLog -EventName 'mariadb.datadir.reuse_repairing' -Details @{ DataDir = $dbDataDir; ServiceName = $serviceName }
      Repair-MariaDbService -MariaServerExe $mariaServerExe -ServiceName $serviceName -DataDir $dbDataDir -Port $dbPort -StdOutPath $mariaStdOutLog -StdErrPath $mariaStdErrLog
      $serviceExists = $true
    } else {
      Write-EventLog -EventName 'mariadb.datadir.reset' -Details @{ DataDir = $dbDataDir; Reason = 'previous setup did not complete' }
      Clear-DirectoryContents -Path $dbDataDir
    }
  }

  if (-not $serviceExists) {
    Write-EventLog -EventName 'mariadb.install.start' -Details @{ ServiceName = $serviceName; Port = $dbPort }
    $mariaExitCode = Invoke-LoggedProcess -FilePath $mariaInstallExe -Arguments @(
      "--datadir=$dbDataDir",
      "--service=$serviceName",
      "--password=$dbPassword",
      "--port=$dbPort",
      '--allow-remote-root-access',
      '--verbose-bootstrap'
    ) -StdOutPath $mariaStdOutLog -StdErrPath $mariaStdErrLog

    if ($mariaExitCode -ne 0) {
      Write-EventLog -EventName 'mariadb.install.failed' -Details @{
        ExitCode = $mariaExitCode
        StdOutLog = $mariaStdOutLog
        StdErrLog = $mariaStdErrLog
      }
      throw (Get-MariaDbServiceInstallError -ExitCode $mariaExitCode -StdOutPath $mariaStdOutLog -StdErrPath $mariaStdErrLog -Action 'initialization')
    }

    Write-EventLog -EventName 'mariadb.install.ready' -Details @{ ServiceName = $serviceName; Port = $dbPort }
  }
}

sc.exe start $serviceName | Out-Null
if (-not (Wait-ForTcpPort -Port ([int]$dbPort) -TimeoutSeconds 45)) {
  Write-EventLog -EventName 'mariadb.service.timeout' -Details @{ ServiceName = $serviceName; Port = $dbPort }
  throw "MariaDB service '$serviceName' did not become ready on port $dbPort in time."
}
Write-EventLog -EventName 'mariadb.service.started' -Details @{ ServiceName = $serviceName; Port = $dbPort }

$env:APP_DATA_DIR = $appDataDir
$env:APP_ENV_FILE = $envFile
$env:APP_LOGS_DIR = $logsDir
$env:NODE_ENV = 'production'

Write-EventLog -EventName 'runtime.init.start' -Details @{ Script = $initRuntimeScript }
$runtimeExitCode = Invoke-LoggedProcess -FilePath $nodeExe -Arguments @($initRuntimeScript) -StdOutPath $runtimeStdOutLog -StdErrPath $runtimeStdErrLog
if ($runtimeExitCode -ne 0) {
  $runtimeTail = @(
    Get-LogTail -Path $runtimeStdErrLog -LineCount 40
    Get-LogTail -Path $runtimeStdOutLog -LineCount 40
  ) | Where-Object { $_ }

  Write-EventLog -EventName 'runtime.init.failed' -Details @{
    ExitCode = $runtimeExitCode
    StdOutLog = $runtimeStdOutLog
    StdErrLog = $runtimeStdErrLog
    RecentOutput = ($runtimeTail -join "`n")
  }

  if ($runtimeTail.Count -gt 0) {
    throw "Application runtime initialization failed with exit code $runtimeExitCode.`nSee $runtimeStdErrLog and $runtimeStdOutLog for details.`n`nRecent output:`n$($runtimeTail -join "`n")"
  }

  throw "Application runtime initialization failed with exit code $runtimeExitCode. See $runtimeStdErrLog and $runtimeStdOutLog for details."
}
Write-EventLog -EventName 'runtime.init.ready' -Details @{ EnvFile = $envFile }
