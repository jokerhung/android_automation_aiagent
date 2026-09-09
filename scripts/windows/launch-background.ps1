param(
 [Parameter(Mandatory=$true)][ValidateScript({[System.IO.Path]::IsPathRooted($_)})][string]$AppRoot,
 [Parameter(Mandatory=$true)][ValidateScript({[System.IO.Path]::IsPathRooted($_)})][string]$NodePath
)
$ErrorActionPreference='Stop'
# This hidden launcher remains alive to drain both pipes and record Node's exit.
# It does not restart or terminate the host, or change Startup registration.
$script:logFile=$null
$script:logMutex=$null
$exitCode=1
$process=$null

function Scrub([string]$message) {
 $message=$message -replace 'sk-[A-Za-z0-9_-]{10,}','[REDACTED]'
 $message=$message -replace '(?i)data:image/[^;\s]+;base64,[A-Za-z0-9+/=_-]+','[REDACTED]'
 $message=$message -replace '(?i)Bearer\s+[^\s,;]+','Bearer [REDACTED]'
 $message=$message -replace '(?i)(["'']?(?:[A-Za-z0-9_-]*(?:password|passwd|secret|token|api[_-]?key)|smtp[_-]?pass)["'']?\s*[:=]\s*)(?:"[^"]*(?:"|$)|''[^'']*(?:''|$)|[^\s,;}]+)','$1[REDACTED]'
 $message=$message -replace '(?i)(https?|smtps?)://[^\s/@]+:[^\s/@]+@','$1://[REDACTED]@'
 $message=$message -replace '[\r\n]+',' '
 if($message.Length -gt 8192){$message=$message.Substring(0,8192)+' [truncated]'}
 return $message
}

function Write-LauncherLog([string]$message) {
 $safe=Scrub $message
 $line=([DateTime]::UtcNow.ToString('o'))+' launcher='+$PID+' '+$safe+[Environment]::NewLine
 if($null -eq $script:logFile){[Console]::Error.WriteLine($line);return}
 $locked=$false
 try {
  try {$locked=$script:logMutex.WaitOne(2000)} catch [Threading.AbandonedMutexException] {$locked=$true}
  if(-not $locked){throw 'Launcher log mutex timeout'}
  # Three files at most, including the active log. All paths are fixed owned files.
  if((Test-Path -LiteralPath $script:logFile) -and (Get-Item -LiteralPath $script:logFile).Length -ge 5242880){
   if(Test-Path -LiteralPath ($script:logFile+'.2')){[IO.File]::Delete($script:logFile+'.2')}
   if(Test-Path -LiteralPath ($script:logFile+'.1')){[IO.File]::Move($script:logFile+'.1',$script:logFile+'.2')}
   [IO.File]::Move($script:logFile,$script:logFile+'.1')
  }
  [IO.File]::AppendAllText($script:logFile,$line,[Text.UTF8Encoding]::new($false))
 } catch {[Console]::Error.WriteLine('LAUNCHER_LOG_WRITE_FAILED: '+(Scrub $_.Exception.Message))}
 finally {if($locked){[void]$script:logMutex.ReleaseMutex()}}
}

function New-PipeReader($stream,[string]$name) {
 $buffer=New-Object char[] 4096
 return @{Stream=$stream;Name=$name;Buffer=$buffer;Task=$stream.ReadAsync($buffer,0,$buffer.Length);Pending='';Dropping=$false;Done=$false}
}

function Read-Pipe($reader) {
 if($reader.Done -or -not $reader.Task.IsCompleted){return}
 try {$count=$reader.Task.GetAwaiter().GetResult()} catch {
  Write-LauncherLog ('pipe_error '+$reader.Name+' '+$_.Exception.Message)
  $reader.Done=$true;return
 }
 if($count -eq 0){
  if($reader.Pending){Write-LauncherLog ($reader.Name+': '+$reader.Pending)}
  $reader.Done=$true;return
 }
 # Retain one bounded line per pipe; discard the tail, not chunks that may split secrets.
 for($i=0;$i -lt $count;$i++){
  $character=$reader.Buffer[$i]
  if($character -eq [char]10){
   Write-LauncherLog ($reader.Name+': '+$reader.Pending+$(if($reader.Dropping){' [truncated]'}else{''}))
   $reader.Pending='';$reader.Dropping=$false
  } elseif(-not $reader.Dropping){
   if($reader.Pending.Length -lt 8192){$reader.Pending+=$character}else{$reader.Dropping=$true}
  }
 }
 $reader.Task=$reader.Stream.ReadAsync($reader.Buffer,0,$reader.Buffer.Length)
}

try {
 $local=[Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
 if([string]::IsNullOrWhiteSpace($local)){throw 'LOCALAPPDATA_MISSING'}
 $sha=[Security.Cryptography.SHA256]::Create()
 try {$rootId=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes([IO.Path]::GetFullPath($AppRoot).TrimEnd('\').ToLowerInvariant())))).Replace('-','').Substring(0,16).ToLowerInvariant()}finally{$sha.Dispose()}
 $logDirectory=Join-Path $local ('AndroidAgent\launcher\'+$rootId)
 # Set the DACL directly, without requesting SACL/SeSecurityPrivilege.
 $security=New-Object Security.AccessControl.DirectorySecurity
 $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
 $security.SetOwner($sid)
 $security.SetAccessRuleProtection($true,$false)
 foreach($owner in @($sid,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))){
  $security.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($owner,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
 }
 [void][IO.Directory]::CreateDirectory($logDirectory,$security)
 [IO.Directory]::SetAccessControl($logDirectory,$security)
 $script:logFile=Join-Path $logDirectory 'launcher.log'
 $script:logMutex=[Threading.Mutex]::new($false,('Local\AndroidAgentLauncherLog-'+$rootId))
 Write-LauncherLog ('launch_begin appRoot='+$AppRoot+' node='+$NodePath+' session='+[Diagnostics.Process]::GetCurrentProcess().SessionId)
 $entry=Join-Path $AppRoot 'scripts\start-background.ts'
 $tsx=Join-Path $AppRoot 'node_modules\tsx\dist\loader.mjs'
 if(-not (Test-Path -LiteralPath $NodePath -PathType Leaf)){throw 'NODE_MISSING'}
 if(-not (Test-Path -LiteralPath $entry -PathType Leaf)){throw 'BACKGROUND_ENTRY_MISSING'}
 if(-not (Test-Path -LiteralPath $tsx -PathType Leaf)){throw 'TSX_LOADER_MISSING'}
 Write-LauncherLog ('preflight buildExists='+(Test-Path -LiteralPath (Join-Path $AppRoot '.next\BUILD_ID'))+' loaderExists=True')
 $info=New-Object System.Diagnostics.ProcessStartInfo
 $info.FileName=$NodePath
 $info.WorkingDirectory=$AppRoot
 $info.UseShellExecute=$false
 $info.CreateNoWindow=$true
 $info.WindowStyle=[System.Diagnostics.ProcessWindowStyle]::Hidden
 $info.RedirectStandardOutput=$true
 $info.RedirectStandardError=$true
 $info.StandardOutputEncoding=[Text.UTF8Encoding]::new($false)
 $info.StandardErrorEncoding=[Text.UTF8Encoding]::new($false)
 $tsxUri=([System.Uri]::new($tsx)).AbsoluteUri
 $info.Arguments=('--import "{0}" "{1}" --host' -f $tsxUri,$entry)
 $info.EnvironmentVariables['NODE_ENV']='production'
 $process=New-Object System.Diagnostics.Process
 $process.StartInfo=$info
 if(-not $process.Start()){throw 'BACKGROUND_START_FAILED'}
 Write-LauncherLog ('node_spawned pid='+$process.Id)
 $readers=@((New-PipeReader $process.StandardOutput 'stdout'),(New-PipeReader $process.StandardError 'stderr'))
 $started=[DateTime]::UtcNow;$lastHeartbeat=$started;$exitedAt=$null
 while($true){
  foreach($reader in $readers){Read-Pipe $reader}
  if($process.HasExited){
   if($null -eq $exitedAt){$exitedAt=[DateTime]::UtcNow}
   if(($readers[0].Done -and $readers[1].Done) -or ([DateTime]::UtcNow-$exitedAt).TotalSeconds -gt 3){break}
  }
  if(([DateTime]::UtcNow-$lastHeartbeat).TotalSeconds -ge 30){
   Write-LauncherLog ('node_alive pid='+$process.Id+' (process alive; readiness is recorded by host)')
   $lastHeartbeat=[DateTime]::UtcNow
  }
  Start-Sleep -Milliseconds 50
 }
 $exitCode=$process.ExitCode
 Write-LauncherLog ('node_exit pid='+$process.Id+' code='+$exitCode+' elapsedMs='+[long]([DateTime]::UtcNow-$started).TotalMilliseconds)
} catch {
 Write-LauncherLog ('launcher_error '+$_.Exception.Message+' at '+$_.InvocationInfo.ScriptLineNumber)
} finally {
 if($null -ne $process){$process.Dispose()}
 if($null -ne $script:logMutex){$script:logMutex.Dispose()}
}
exit $exitCode
