<#
  Phone <-> laptop over the USB cable.

  `adb reverse tcp:8080 tcp:8080` makes the phone's own 127.0.0.1:8080 reach
  this laptop's server. The page therefore never leaves the device, needs no
  WiFi, no router, no internet and no app install.

  Usage:  double-click connect-phone.bat
  or:     powershell -ExecutionPolicy Bypass -File tools\tunnel.ps1
#>

$ErrorActionPreference = 'Stop'
$port = if ($env:FPV_PORT) { $env:FPV_PORT } else { 8080 }

function Fail($message) {
  Write-Host ''
  Write-Host "  $message" -ForegroundColor Red
  Write-Host ''
  Read-Host 'Press Enter to close'
  exit 1
}

# prefer the platform-tools bundled in this repo
$bundled = Join-Path $PSScriptRoot 'platform-tools\adb.exe'
if (Test-Path $bundled) {
  $adb = $bundled
} else {
  $found = Get-Command adb -ErrorAction SilentlyContinue
  if (-not $found) {
    Fail "adb not found. Download platform-tools from https://developer.android.com/tools/releases/platform-tools and unzip it into tools\platform-tools"
  }
  $adb = $found.Source
}

$version = (& $adb version) -join ' '
if ($version -match 'version 1\.0\.(2\d|3[01])\b') {
  Fail "This adb ($version) has no 'reverse' command. The bundled tools\platform-tools\adb.exe is new enough - use that one."
}

Write-Host "adb: $adb" -ForegroundColor DarkGray

$devices = (& $adb devices) -split "`r?`n" | Where-Object { $_ -match "`tdevice$" }
if (-not $devices -or $devices.Count -eq 0) {
  Write-Host ''
  Write-Host 'No phone detected yet. Checklist:' -ForegroundColor Yellow
  Write-Host '  1. use a data USB cable (not charge-only)'
  Write-Host '  2. phone: Settings -> About phone -> tap Build number 7x'
  Write-Host '  3. phone: Developer options -> USB debugging = ON'
  Write-Host '  4. replug, then tap "Allow USB debugging" on the phone'
  Write-Host '  5. USB mode: File transfer / MTP'
  Write-Host ''
  Write-Host 'Waiting for a device (Ctrl+C to give up)...' -ForegroundColor DarkGray
  & $adb wait-for-device
  $devices = (& $adb devices) -split "`r?`n" | Where-Object { $_ -match "`tdevice$" }
  if (-not $devices) { Fail 'Still no device. Replug the cable and try again.' }
}

Write-Host "device: $($devices -join ', ')" -ForegroundColor Green

& $adb reverse --remove-all 2>$null | Out-Null
$result = & $adb reverse "tcp:$port" "tcp:$port" 2>&1
if ($LASTEXITCODE -ne 0) {
  Fail "adb reverse failed: $result"
}

$list = (& $adb reverse --list) -join "`n"
Write-Host "tunnel: $list" -ForegroundColor Green
Write-Host ''
Write-Host "  Phone  : Chrome -> http://127.0.0.1:$port/tx/" -ForegroundColor Cyan
Write-Host "  Laptop : http://127.0.0.1:$port/sim/" -ForegroundColor Cyan
Write-Host ''
Write-Host 'Keep the cable plugged in. Re-run this after unplugging.' -ForegroundColor DarkGray
Write-Host ''
Read-Host 'Press Enter to close'
