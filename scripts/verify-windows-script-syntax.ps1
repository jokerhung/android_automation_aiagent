$ErrorActionPreference = "Stop"
$failed = $false
$root = Split-Path -Parent $PSScriptRoot
foreach ($name in @("autostart.ps1", "launch-background.ps1", "tray.ps1", "set-protected-acl.ps1", "open-home.ps1")) {
  $file = Join-Path $root ("scripts/windows/" + $name)
  $tokens = $null
  $parseErrors = $null
  [System.Management.Automation.Language.Parser]::ParseFile($file, [ref]$tokens, [ref]$parseErrors) | Out-Null
  if ($parseErrors.Count) {
    $failed = $true
    $parseErrors | ForEach-Object { Write-Output ("{0}:{1}: {2}" -f $name, $_.Extent.StartLineNumber, $_.Message) }
  } else { Write-Output ("PASS syntax: " + $name) }
}
if ($failed) { exit 1 }
