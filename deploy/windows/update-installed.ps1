param(
  [string]$SourceDir = $PSScriptRoot,
  [string]$InstallDir = (Join-Path $env:ProgramFiles 'BizTracker'),
  [switch]$SkipRestart
)

$ErrorActionPreference = 'Stop'

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Normalize-PathArgument {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $Value
  }

  $trimmed = $Value.Trim()
  while ($trimmed.Length -ge 2 -and (
    ($trimmed.StartsWith('"') -and $trimmed.EndsWith('"')) -or
    ($trimmed.StartsWith("'") -and $trimmed.EndsWith("'"))
  )) {
    $trimmed = $trimmed.Substring(1, $trimmed.Length - 2).Trim()
  }

  return $trimmed.TrimEnd('\')
}

function Restart-Elevated {
  $normalizedSourceDir = Normalize-PathArgument -Value $SourceDir
  $normalizedInstallDir = Normalize-PathArgument -Value $InstallDir
  $argumentList = @(
    '-NoProfile'
    '-ExecutionPolicy Bypass'
    ('-File "{0}"' -f $PSCommandPath)
    ('-SourceDir "{0}"' -f $normalizedSourceDir)
    ('-InstallDir "{0}"' -f $normalizedInstallDir)
  )

  if ($SkipRestart) {
    $argumentList += '-SkipRestart'
  }

  try {
    $process = Start-Process -FilePath 'powershell.exe' -Verb RunAs -WorkingDirectory $normalizedSourceDir -ArgumentList ($argumentList -join ' ') -Wait -PassThru
  } catch {
    throw 'The updater needs administrator permission to continue. Approve the Windows UAC prompt, then run the updater again if needed.'
  }

  exit $process.ExitCode
}

function Write-Step {
  param([string]$Message)
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Stop-BizTrackerProcesses {
  param([string]$InstallDir = '')

  $pids = [System.Collections.Generic.HashSet[uint32]]::new()

  # Processes whose executable lives inside the install directory (e.g. bundled node.exe)
  if ($InstallDir) {
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object { $_.ExecutablePath -and $_.ExecutablePath -like "$InstallDir\*" } |
      ForEach-Object { $null = $pids.Add($_.ProcessId) }
  }

  # The API server (node running server\index.js) and the launcher script, matched
  # by their specific command-line signatures rather than a broad app-name pattern
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.CommandLine -and (
        $_.CommandLine -like '*launch-app.vbs*' -or
        $_.CommandLine -like '*launch-app.ps1*' -or
        $_.CommandLine -like '*server\index.js*'
      )
    } |
    ForEach-Object { $null = $pids.Add($_.ProcessId) }

  foreach ($processId in $pids) {
    try {
      $proc = Get-Process -Id $processId -ErrorAction SilentlyContinue
      if ($proc) {
        Stop-Process -Id $processId -Force -ErrorAction Stop
        Write-Host ("Stopped process {0} ({1})" -f $processId, $proc.ProcessName) -ForegroundColor DarkGray
      }
    } catch {
    }
  }
}

function Copy-Directory {
  param(
    [string]$From,
    [string]$To
  )

  New-Item -ItemType Directory -Path $To -Force | Out-Null
  $null = & robocopy $From $To /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP
  $exitCode = $LASTEXITCODE
  if ($exitCode -ge 8) {
    throw "Robocopy failed copying '$From' to '$To' with exit code $exitCode."
  }
}

function Copy-FileIfPresent {
  param(
    [string]$From,
    [string]$To
  )

  if (Test-Path $From) {
    Copy-Item -Path $From -Destination $To -Force
  }
}

function Update-LaunchShortcuts {
  param([string]$InstallDir)

  $targetPath = Join-Path $InstallDir 'launch-app.cmd'
  if (-not (Test-Path $targetPath)) {
    return
  }

  $shortcutPaths = @(
    (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\BizTracker.lnk'),
    (Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'BizTracker.lnk')
  )

  try {
    $shell = New-Object -ComObject WScript.Shell
    foreach ($shortcutPath in $shortcutPaths) {
      $shortcutDir = Split-Path -Parent $shortcutPath
      if ($shortcutDir) {
        New-Item -ItemType Directory -Path $shortcutDir -Force | Out-Null
      }

      $shortcut = $shell.CreateShortcut($shortcutPath)
      $shortcut.TargetPath = $targetPath
      $shortcut.WorkingDirectory = $InstallDir
      $shortcut.IconLocation = "$targetPath,0"
      $shortcut.Save()
    }
  } catch {
    Write-Host ("Shortcut refresh skipped: {0}" -f $_.Exception.Message) -ForegroundColor DarkYellow
  }
}

function Get-ServiceAppDataDir {
  $serviceNames = @('GCashPosLocalMariaDB', 'BizTrackerMariaDB')
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

function Get-RuntimeEnvFile {
  $primary = Join-Path $env:ProgramData 'BizTracker\config\app.env'
  $legacyShared = Join-Path $env:ProgramData 'GCashPOSLocal\config\app.env'
  $legacyUser = Join-Path $env:LOCALAPPDATA 'GCashPOSLocal\config\app.env'

  $serviceAppDataDir = Get-ServiceAppDataDir
  if ($serviceAppDataDir) {
    $serviceEnvFile = Join-Path $serviceAppDataDir 'config\app.env'
    if (Test-Path $serviceEnvFile) {
      return $serviceEnvFile
    }
  }

  foreach ($candidate in @($primary, $legacyShared, $legacyUser)) {
    if (-not $candidate -or -not (Test-Path $candidate)) {
      continue
    }

    $runtimeDir = Split-Path -Parent (Split-Path -Parent $candidate)
    $dbDataDir = Join-Path $runtimeDir 'mariadb-data'
    if (Test-Path $dbDataDir) {
      $hasDbData = Get-ChildItem -Path $dbDataDir -Force -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($hasDbData) {
        return $candidate
      }
    }
  }

  foreach ($candidate in @($primary, $legacyShared, $legacyUser)) {
    if ($candidate -and (Test-Path $candidate)) {
      return $candidate
    }
  }

  return $primary
}

function Resolve-InstallDir {
  param([string]$RequestedDir)

  $candidates = @()

  if (-not [string]::IsNullOrWhiteSpace($RequestedDir)) {
    $candidates += $RequestedDir
  }

  if ($PSScriptRoot) {
    $candidates += $PSScriptRoot
  }

  if ($env:ProgramFiles) {
    $candidates += (Join-Path $env:ProgramFiles 'BizTracker')
  }

  if (${env:ProgramFiles(x86)}) {
    $candidates += (Join-Path ${env:ProgramFiles(x86)} 'BizTracker')
  }

  foreach ($candidate in ($candidates | Where-Object { $_ } | Select-Object -Unique)) {
    if ((Test-Path $candidate) -and (Test-Path (Join-Path $candidate 'launch-app.ps1'))) {
      return $candidate
    }
  }

  return $RequestedDir
}

function Set-Or-ReplaceEnvValue {
  param(
    [string[]]$Lines,
    [string]$Key,
    [string]$Value
  )

  $updated = $false
  $result = foreach ($line in $Lines) {
    if ($line -match ('^{0}=' -f [regex]::Escape($Key))) {
      $updated = $true
      '{0}={1}' -f $Key, $Value
    } else {
      $line
    }
  }

  if (-not $updated) {
    $result += '{0}={1}' -f $Key, $Value
  }

  return ,$result
}

function Normalize-RuntimeConfig {
  $envFile = Get-RuntimeEnvFile
  $envDir = Split-Path -Parent $envFile
  New-Item -ItemType Directory -Path $envDir -Force | Out-Null

  $lines = if (Test-Path $envFile) {
    Get-Content -Path $envFile
  } else {
    @('APP_MODE=production')
  }

  # Always force the binding host to :: (dual-stack) so the server accepts both
  # IPv4 (127.0.0.1, LAN IPs) and IPv6 (::1 — what Chrome resolves 'localhost' to on Windows)
  $lines = Set-Or-ReplaceEnvValue -Lines $lines -Key 'API_HOST' -Value '::'

  # Force old runtime configs off the development port and keep the packaged app on its own API port.
  $apiPortLine = $lines | Where-Object { $_ -match '^API_PORT=' } | Select-Object -First 1
  if ((-not $apiPortLine) -or ($apiPortLine -match '^API_PORT=4000\s*$')) {
    $lines = Set-Or-ReplaceEnvValue -Lines $lines -Key 'API_PORT' -Value '4010'
  }

  $defaults = [ordered]@{
    'APP_PUBLIC_BASE_URL' = ''
    'VITE_APP_URL'        = ''
  }
  foreach ($key in $defaults.Keys) {
    $present = $lines | Where-Object { $_ -match ('^{0}=' -f [regex]::Escape($key)) }
    if (-not $present) {
      $lines = Set-Or-ReplaceEnvValue -Lines $lines -Key $key -Value $defaults[$key]
    }
  }

  Set-Content -Path $envFile -Value $lines -Encoding ASCII
  Write-Host ("Normalized runtime config: {0}" -f $envFile) -ForegroundColor DarkGray
}

try {
  $SourceDir = Normalize-PathArgument -Value $SourceDir
  $InstallDir = Normalize-PathArgument -Value $InstallDir

  if (-not (Test-IsAdministrator)) {
    Restart-Elevated
  }

  if (-not (Test-Path (Join-Path $SourceDir 'server\index.js'))) {
    throw "Source folder does not look like a staged BizTracker app: $SourceDir"
  }

  $InstallDir = Resolve-InstallDir -RequestedDir $InstallDir
  if (-not (Test-Path $InstallDir)) {
    throw "Installed BizTracker folder was not found. Make sure BizTracker is already installed, then run the updater again."
  }

  $resolvedSource = (Resolve-Path $SourceDir -ErrorAction SilentlyContinue).Path
  $resolvedTarget = (Resolve-Path $InstallDir -ErrorAction SilentlyContinue).Path
  if ($resolvedSource -and $resolvedTarget -and ($resolvedSource -eq $resolvedTarget)) {
    throw "Source and install directory are the same path ($InstallDir). Extract the updater bundle to a separate folder before running the updater."
  }

  Write-Step "Updating BizTracker"
  Write-Host ("Source : {0}" -f $SourceDir)
  Write-Host ("Target : {0}" -f $InstallDir)
  Write-Host 'Data in ProgramData\BizTracker will be preserved.' -ForegroundColor Green

  Stop-BizTrackerProcesses -InstallDir $InstallDir
  Start-Sleep -Seconds 3

  Write-Step 'Copying application files'
  Copy-Directory -From (Join-Path $SourceDir 'dist') -To (Join-Path $InstallDir 'dist')
  Copy-Directory -From (Join-Path $SourceDir 'server') -To (Join-Path $InstallDir 'server')

  $vendorSource = Join-Path $SourceDir 'vendor'
  if (Test-Path $vendorSource) {
    Write-Step 'Copying vendor runtime'
    Copy-Directory -From $vendorSource -To (Join-Path $InstallDir 'vendor')
  } else {
    Write-Host 'Vendor runtime not in update bundle — keeping existing runtime on device.' -ForegroundColor DarkGray
  }

  $singleFiles = @(
    'install-db.ps1',
    'uninstall-db.ps1',
    'launch-app.ps1',
    'launch-app.vbs',
    'launch-app.cmd',
    'run-api.cmd',
    'README.md',
    'update-installed.ps1',
    'update-installed.cmd'
  )

  foreach ($file in $singleFiles) {
    Copy-FileIfPresent -From (Join-Path $SourceDir $file) -To (Join-Path $InstallDir $file)
  }

  Write-Step 'Normalizing runtime network config'
  Normalize-RuntimeConfig

  Write-Step 'Refreshing app shortcuts'
  Update-LaunchShortcuts -InstallDir $InstallDir

  Write-Step 'Refreshing runtime and schema'
  $psExe = if (Get-Command 'pwsh.exe' -ErrorAction SilentlyContinue) { 'pwsh.exe' } else { 'powershell.exe' }
  & $psExe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $InstallDir 'install-db.ps1') -AppDir $InstallDir
  if ($LASTEXITCODE -ne 0) {
    throw "Runtime refresh failed with exit code $LASTEXITCODE."
  }

  if (-not $SkipRestart) {
    Write-Step 'Launching updated app'
    Start-Process -FilePath 'wscript.exe' -ArgumentList ('"{0}"' -f (Join-Path $InstallDir 'launch-app.vbs'))
  }

  Write-Host ''
  Write-Host 'BizTracker update completed successfully.' -ForegroundColor Green
  Write-Host 'Your existing database and config were kept intact.' -ForegroundColor Green
  exit 0
} catch {
  Write-Host ''
  Write-Host ('Update failed: {0}' -f $_.Exception.Message) -ForegroundColor Red
  if ($_.InvocationInfo) {
    Write-Host ('  at line {0}: {1}' -f $_.InvocationInfo.ScriptLineNumber, $_.InvocationInfo.Line.Trim()) -ForegroundColor DarkRed
  }
  exit 1
}
