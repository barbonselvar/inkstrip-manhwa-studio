# Installs the NSIS installer silently on the Windows runner, launches Inkstrip with
# WebView2 remote debugging enabled, runs native-smoke.mjs against the app's own
# WebView, restarts it to check persistence, then uninstalls. See native-apps.yml.
$ErrorActionPreference = "Stop"
$out = "native-smoke"
New-Item -ItemType Directory -Force -Path $out | Out-Null
$failed = $false
function Check($name, [bool]$ok, $detail = "") {
  $line = "{0}  {1} {2}" -f ($(if ($ok) { "PASS" } else { "FAIL" })), $name, $detail
  Write-Host $line
  Add-Content "$out\windows-install-checks.txt" $line
  if (-not $ok) { $script:failed = $true }
}

$installer = Get-ChildItem dist\*.exe | Select-Object -First 1
(Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, BuildNumber | Format-List | Out-String).Trim() | Tee-Object "$out\windows-os.txt"
$wv = Get-ItemProperty "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" -ErrorAction SilentlyContinue
"WebView2 Runtime: $($wv.pv)" | Tee-Object -Append "$out\windows-os.txt"

$sw = [Diagnostics.Stopwatch]::StartNew()
$p = Start-Process $installer.FullName -ArgumentList "/S" -Wait -PassThru
Check "Silent per-user install exits 0" ($p.ExitCode -eq 0) "(exit $($p.ExitCode), $([int]$sw.Elapsed.TotalSeconds) s)"

$installDir = Join-Path $env:LOCALAPPDATA "Inkstrip"
$app = Join-Path $installDir "Inkstrip.exe"
Check "Inkstrip.exe installed to %LOCALAPPDATA%\Inkstrip" (Test-Path $app)
$uninstallKey = Get-ChildItem "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall" | Get-ItemProperty | Where-Object { $_.DisplayName -eq "Inkstrip" } | Select-Object -First 1
Check "Registered in Apps & features" ($null -ne $uninstallKey) "(version $($uninstallKey.DisplayVersion))"
$shortcut = Get-ChildItem "$env:APPDATA\Microsoft\Windows\Start Menu\Programs" -Recurse -Filter "Inkstrip.lnk" -ErrorAction SilentlyContinue | Select-Object -First 1
Check "Start menu shortcut created" ($null -ne $shortcut) "$($shortcut.FullName)"
if (Test-Path $app) {
  $ver = (Get-Item $app).VersionInfo
  "Product: $($ver.ProductName) $($ver.ProductVersion); size $([math]::Round((Get-Item $app).Length / 1MB, 1)) MB" | Tee-Object "$out\windows-binary.txt"
}

function Start-Inkstrip {
  Get-Process Inkstrip -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep 2
  $env:INKSTRIP_WEBVIEW2_DEBUG_PORT = "9222"
  $proc = Start-Process $app -PassThru
  Remove-Item Env:\INKSTRIP_WEBVIEW2_DEBUG_PORT
  return $proc
}

$proc = Start-Inkstrip
node apps/scripts/native-smoke.mjs --platform windows --phase main --out $out --timeout 180
if ($LASTEXITCODE -ne 0) { $failed = $true }

$main = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
Check "App process still running after the smoke test" ($null -ne $main)
if ($main) {
  $main.Refresh()
  Check "Window title is Inkstrip" ($main.MainWindowTitle -eq "Inkstrip") "('$($main.MainWindowTitle)')"
  $children = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "msedgewebview2.exe" }
  $ws = $main.WorkingSet64 + (($children | ForEach-Object { (Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue).WorkingSet64 }) | Measure-Object -Sum).Sum
  "Inkstrip.exe working set: {0:N0} MB; with WebView2 processes: {1:N0} MB" -f ($main.WorkingSet64 / 1MB), ($ws / 1MB) | Tee-Object "$out\windows-memory.txt"
}

$proc = Start-Inkstrip
node apps/scripts/native-smoke.mjs --platform windows --phase verify-restart --out $out --timeout 180
if ($LASTEXITCODE -ne 0) { $failed = $true }
Get-Process Inkstrip -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 3

$un = Join-Path $installDir "uninstall.exe"
if (Test-Path $un) {
  $p = Start-Process $un -ArgumentList "/S" -Wait -PassThru
  Start-Sleep 5
  Check "Silent uninstall removes the app" (-not (Test-Path $app)) "(exit $($p.ExitCode))"
} else {
  Check "Uninstaller present" $false
}

if ($failed) { throw "Windows device test failed" }
