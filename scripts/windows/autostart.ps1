param(
 [Parameter(Mandatory=$true)][ValidateSet('status','enable','disable')][string]$Action,
 [Parameter(Mandatory=$true)][ValidateScript({[System.IO.Path]::IsPathRooted($_)})][string]$AppRoot,
 [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{16}$')][string]$InstallationId,
 [Parameter(Mandatory=$true)][ValidateScript({[System.IO.Path]::IsPathRooted($_)})][string]$LauncherPath,
 [Parameter(Mandatory=$true)][ValidateScript({[System.IO.Path]::IsPathRooted($_)})][string]$NodePath
)
$ErrorActionPreference='Stop'
$script:backgroundReady=$true
$script:readinessReason=$null
foreach($relative in @('.next/BUILD_ID','node_modules/tsx/dist/loader.mjs','node_modules/next/package.json','node_modules/better-sqlite3/package.json','scripts/windows/tray.ps1','scripts/start-background.ts')){
 if(-not (Test-Path -LiteralPath (Join-Path $AppRoot $relative) -PathType Leaf)){
  $script:backgroundReady=$false
  $script:readinessReason='Background prerequisite missing: '+$relative
  break
 }
}
$script:interactive=[Environment]::UserInteractive -and [Diagnostics.Process]::GetCurrentProcess().SessionId -ne 0
if(-not $script:interactive){$script:backgroundReady=$false;$script:readinessReason='Interactive Windows desktop required'}
if(-not (Test-Path -LiteralPath $NodePath -PathType Leaf)){$script:backgroundReady=$false;$script:readinessReason='NODE_MISSING'}
if(-not (Test-Path -LiteralPath $LauncherPath -PathType Leaf)){$script:backgroundReady=$false;$script:readinessReason='LAUNCHER_MISSING'}
function Result($enabled,$registration,$reason=$null){
 $result=[ordered]@{supported=$script:interactive;enabled=$enabled;registration=$registration;backgroundReady=$script:backgroundReady}
 if($null -eq $reason){$reason=$script:readinessReason}
 if($null -ne $reason){$result.reason=[string]$reason}
 $result|ConvertTo-Json -Compress
}
$startup=[Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)
if([string]::IsNullOrWhiteSpace($startup)){Result $null 'unknown' 'Startup known folder is unavailable';exit 0}
$name="Android Agent - $InstallationId.lnk";$shortcutPath=Join-Path $startup $name
$powershell=Join-Path $PSHOME 'powershell.exe';if(-not (Test-Path -LiteralPath $NodePath -PathType Leaf)){throw 'NODE_MISSING'}
$arguments='-NoProfile -NonInteractive -WindowStyle Hidden -File "{0}" -AppRoot "{1}" -NodePath "{2}"' -f $LauncherPath,$AppRoot,$NodePath
function ReadShortcut(){if(-not (Test-Path -LiteralPath $shortcutPath -PathType Leaf)){return $null};$shell=New-Object -ComObject WScript.Shell;$link=$shell.CreateShortcut($shortcutPath);return $link}
function Valid($link){return $null-ne $link -and [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetFullPath($link.TargetPath),[IO.Path]::GetFullPath($powershell)) -and $link.Arguments-eq $arguments -and [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetFullPath($link.WorkingDirectory),[IO.Path]::GetFullPath($AppRoot))}
function EffectiveStatus {
 $key='HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder'
 try {
  # A new Startup shortcut need not have an Explorer approval record.
  # Absence is different from a failed read or an explicit disabled record.
  if(-not (Test-Path -LiteralPath $key)){Result $true 'valid';return}
  $properties=Get-ItemProperty -LiteralPath $key -ErrorAction Stop
  $approval=$properties.PSObject.Properties[$name]
  if($null -eq $approval){Result $true 'valid';return}
  $value=$approval.Value
  if($value -isnot [byte[]] -or $value.Length -lt 1){Result $null 'valid' 'Unknown Windows Startup approval format';return}
  if($value[0] -eq 2){Result $true 'valid';return}
  if($value[0] -eq 3){Result $false 'valid' 'Disabled in Windows Startup settings';return}
  Result $null 'valid' 'Unknown Windows Startup approval state'
 } catch {Result $null 'valid' 'Startup registration exists, but its Windows approval state could not be read.'}
}
if($Action-eq 'status'){$link=ReadShortcut;if($null-eq $link){Result $false 'absent'}elseif(Valid $link){EffectiveStatus}else{Result $false 'invalid' 'The shortcut does not belong to this installation'};exit 0}
if($Action-eq 'disable'){$link=ReadShortcut;if($null-eq $link){Result $false 'absent';exit 0};if(-not (Valid $link)){Result $false 'invalid' 'Refusing to remove an unverified shortcut';exit 0};Remove-Item -LiteralPath $shortcutPath -Force;Result $false 'absent';exit 0}
if(-not (Test-Path -LiteralPath $LauncherPath -PathType Leaf)){throw 'LAUNCHER_MISSING'}
if(-not (Test-Path -LiteralPath (Join-Path $AppRoot '.next\BUILD_ID') -PathType Leaf)){throw 'BUILD_MISSING'}
if(-not [Environment]::UserInteractive -or [Diagnostics.Process]::GetCurrentProcess().SessionId -eq 0){throw 'STARTUP_BLOCKED: interactive desktop required'}
foreach($relative in @('node_modules/tsx/dist/loader.mjs','node_modules/next/package.json','node_modules/better-sqlite3/package.json','scripts/windows/tray.ps1','scripts/start-background.ts')){
 if(-not (Test-Path -LiteralPath (Join-Path $AppRoot $relative) -PathType Leaf)){throw ('DEPENDENCY_MISSING: '+$relative)}
}
$local=[Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
if([string]::IsNullOrWhiteSpace($local)){throw 'STARTUP_BLOCKED: LocalApplicationData unavailable'}
$logDirectory=Join-Path $local ('AndroidAgent/'+$InstallationId)
[IO.Directory]::CreateDirectory($logDirectory)|Out-Null
$probe=Join-Path $logDirectory ([Guid]::NewGuid().ToString()+'.probe')
try{[IO.File]::WriteAllText($probe,'preflight')}finally{if(Test-Path -LiteralPath $probe){Remove-Item -LiteralPath $probe -Force}}
$existing=ReadShortcut
if($null -ne $existing -and -not (Valid $existing)){throw "REGISTRATION_INVALID: refusing to overwrite an unverified shortcut"}
$temp=Join-Path $startup ("Android Agent - $InstallationId.$PID.tmp.lnk")
$backup=if($null -ne $existing){[IO.File]::ReadAllBytes($shortcutPath)}else{$null}
$installed=$false
try {
 $shell=New-Object -ComObject WScript.Shell
 $link=$shell.CreateShortcut($temp)
 $link.TargetPath=$powershell
 $link.Arguments=$arguments
 $link.WorkingDirectory=$AppRoot
 $link.WindowStyle=7
 $link.Description='Android Agent background tray'
 $link.Save()
 $candidate=$shell.CreateShortcut($temp)
 if(-not (Valid $candidate)){throw 'STARTUP_WRITE_FAILED: temporary shortcut readback failed'}
 Move-Item -LiteralPath $temp -Destination $shortcutPath -Force
 $installed=$true
 $verified=ReadShortcut
 if(-not (Valid $verified)){throw 'STARTUP_WRITE_FAILED: installed shortcut readback failed'}
} catch {
 if($installed){
  if($null -ne $backup){[IO.File]::WriteAllBytes($shortcutPath,$backup)}
  elseif(Test-Path -LiteralPath $shortcutPath){Remove-Item -LiteralPath $shortcutPath -Force}
 }
 throw
} finally {
 if(Test-Path -LiteralPath $temp){Remove-Item -LiteralPath $temp -Force}
}
EffectiveStatus
