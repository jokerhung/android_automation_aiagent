param(
 [Parameter(Mandatory=$true)][ValidateScript({[System.IO.Path]::IsPathRooted($_)})][string]$AppRoot,
 [Parameter(Mandatory=$true)][ValidateScript({[System.IO.Path]::IsPathRooted($_)})][string]$NodePath
)
$ErrorActionPreference='Stop'
$entry=Join-Path $AppRoot 'scripts\start-background.ts'
$tsx=Join-Path $AppRoot 'node_modules\tsx\dist\loader.mjs'
if(-not (Test-Path -LiteralPath $NodePath -PathType Leaf)){throw 'NODE_MISSING'}
if(-not (Test-Path -LiteralPath $entry -PathType Leaf)){throw 'BACKGROUND_ENTRY_MISSING'}
if(-not (Test-Path -LiteralPath $tsx -PathType Leaf)){throw 'TSX_LOADER_MISSING'}
$info=New-Object System.Diagnostics.ProcessStartInfo
$info.FileName=$NodePath
$info.WorkingDirectory=$AppRoot
$info.UseShellExecute=$false
$info.CreateNoWindow=$true
$info.WindowStyle=[System.Diagnostics.ProcessWindowStyle]::Hidden
$tsxUri=([System.Uri]::new($tsx)).AbsoluteUri
$info.Arguments=('--import "{0}" "{1}" --host' -f $tsxUri,$entry)
$info.EnvironmentVariables['NODE_ENV']='production'
$process=New-Object System.Diagnostics.Process
$process.StartInfo=$info
if(-not $process.Start()){throw 'BACKGROUND_START_FAILED'}
