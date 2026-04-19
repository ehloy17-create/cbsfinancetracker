param(
  [int]$Port = 3319,
  [string]$RootPassword = 'testpass123'
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$tmpRoot = Join-Path $env:TEMP 'biztracker-windows-runtime-verify'
$dataDir = Join-Path $tmpRoot 'data'
$appData = Join-Path $tmpRoot 'appdata'
$mariaInstaller = Join-Path $projectRoot 'deploy\vendor\mariadb-runtime\bin\mariadb-install-db.exe'
$mariaServer = Join-Path $projectRoot 'deploy\vendor\mariadb-runtime\bin\mariadbd.exe'
$nodeExe = Join-Path $projectRoot 'deploy\vendor\node-runtime\node.exe'
$initScript = Join-Path $projectRoot 'server\init-runtime.js'

if (Test-Path $tmpRoot) {
  Remove-Item $tmpRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
New-Item -ItemType Directory -Path $appData -Force | Out-Null

& $mariaInstaller "--datadir=$dataDir" "--password=$RootPassword" "--port=$Port" '--allow-remote-root-access' '--verbose-bootstrap'
if ($LASTEXITCODE -ne 0) {
  throw "mariadb-install-db failed with exit code $LASTEXITCODE"
}

$proc = Start-Process -FilePath $mariaServer -ArgumentList @("--datadir=$dataDir", "--port=$Port", '--console') -PassThru -WindowStyle Hidden
try {
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    try {
      $client = [System.Net.Sockets.TcpClient]::new('127.0.0.1', $Port)
      $client.Close()
      $ready = $true
      break
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }

  if (-not $ready) {
    throw "Bundled MariaDB did not start on port $Port"
  }

  $env:DB_HOST = '127.0.0.1'
  $env:DB_PORT = "$Port"
  $env:DB_USER = 'root'
  $env:DB_PASSWORD = $RootPassword
  $env:DB_NAME = 'gcash_pos'
  $env:APP_DATA_DIR = $appData
  $env:APP_ENV_FILE = Join-Path $appData 'config\app.env'
  $env:APP_LOGS_DIR = Join-Path $appData 'logs'

  & $nodeExe $initScript
  exit $LASTEXITCODE
}
finally {
  if ($proc -and -not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  }
}
