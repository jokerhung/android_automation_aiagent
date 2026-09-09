$ErrorActionPreference="Stop"
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class AndroidAgentIconHandle {
 [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr handle);
}
'@
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
function Text($base64){[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($base64))}
$labelStarting=Text 'QW5kcm9pZCBBZ2VudCDEkWFuZyBraOG7n2kgxJHhu5luZw=='
$labelOpen=Text 'TeG7nyB0cmFuZyBjaOG7pw=='
$labelQuit=Text 'VGhvw6F0IEFuZHJvaWQgQWdlbnQ='
$confirmActive=Text 'VGhvw6F0IHPhur0gZOG7q25nIHswfSB0w6FjIHbhu6UgxJFhbmcgY2jhuqF5LiBC4bqhbiBjw7MgY2jhuq9jIGtow7RuZz8='
$confirmIdle=Text 'QuG6oW4gY8OzIGNo4bqvYyBtdeG7kW4gdGhvw6F0IEFuZHJvaWQgQWdlbnQ/'
$script:homeUrl=$null;$script:homeEnabled=$false;$script:lastOpen=[DateTime]::MinValue
function Emit($event,$message=$null){[Console]::Out.WriteLine((@{event=$event;message=$message}|ConvertTo-Json -Compress));[Console]::Out.Flush()}
function CreateIcon(){
 $bitmap=New-Object Drawing.Bitmap 32,32;$graphics=[Drawing.Graphics]::FromImage($bitmap);$graphics.SmoothingMode='AntiAlias';$graphics.Clear([Drawing.Color]::FromArgb(245,124,0));$font=[Drawing.Font]::new('Segoe UI',21,[Drawing.FontStyle]::Bold,[Drawing.GraphicsUnit]::Pixel);$format=New-Object Drawing.StringFormat;$format.Alignment='Center';$format.LineAlignment='Center';$graphics.DrawString('A',$font,[Drawing.Brushes]::White,(New-Object Drawing.RectangleF 0,0,32,31),$format);$handle=$bitmap.GetHicon();$icon=[Drawing.Icon]::FromHandle($handle).Clone();[void][AndroidAgentIconHandle]::DestroyIcon($handle);$format.Dispose();$graphics.Dispose();$font.Dispose();$bitmap.Dispose();return $icon
}
$notify=New-Object Windows.Forms.NotifyIcon;$notify.Icon=CreateIcon;$notify.Text='Android Agent';$notify.Visible=$true
$menu=New-Object Windows.Forms.ContextMenuStrip;$status=New-Object Windows.Forms.ToolStripMenuItem $labelStarting;$status.Enabled=$false;$open=New-Object Windows.Forms.ToolStripMenuItem $labelOpen;$open.Enabled=$false;$quit=New-Object Windows.Forms.ToolStripMenuItem $labelQuit;[void]$menu.Items.Add($status);[void]$menu.Items.Add($open);[void]$menu.Items.Add((New-Object Windows.Forms.ToolStripSeparator));[void]$menu.Items.Add($quit);$notify.ContextMenuStrip=$menu
$openAction={if(-not $script:homeEnabled -or [string]::IsNullOrWhiteSpace($script:homeUrl)){return};if(([DateTime]::UtcNow-$script:lastOpen).TotalMilliseconds-lt 600){return};$script:lastOpen=[DateTime]::UtcNow;Emit 'open-home'}
$open.add_Click($openAction);$notify.add_DoubleClick($openAction);$quit.add_Click({Emit 'quit-requested'})
Add-Type -TypeDefinition @'
using System;
using System.Collections.Concurrent;
using System.IO;
using System.Threading;
public static class AndroidAgentTrayInput {
 public static Thread Start(TextReader input, ConcurrentQueue<string> queue) {
  var thread = new Thread(() => {
   try { string line; while ((line = input.ReadLine()) != null) queue.Enqueue(line); }
   catch { }
   finally { queue.Enqueue("{\"command\":\"dispose\"}"); }
  });
  thread.IsBackground = true; thread.Name = "AndroidAgentTrayInput"; thread.Start(); return thread;
 }
}
'@
$queue=New-Object 'System.Collections.Concurrent.ConcurrentQueue[string]';$reader=[AndroidAgentTrayInput]::Start([Console]::In,$queue)
$timer=New-Object Windows.Forms.Timer
$timer.Interval=100
$timer.add_Tick({
 $line=$null
 while($queue.TryDequeue([ref]$line)){
  try {
   $command=$line|ConvertFrom-Json
   if($command.command -eq 'initialize'){
    $script:homeUrl=[string]$command.homeUrl
    $status.Text=[string]$command.status
    Emit 'ready'
   } elseif($command.command -eq 'set-status'){
    $status.Text=[string]$command.status
    $script:homeEnabled=[bool]$command.homeEnabled
    $open.Enabled=$script:homeEnabled
   } elseif($command.command -eq 'confirm-quit'){
    $count=[int]$command.activeRuns
    if($count -gt 0){$message=$confirmActive -f $count}else{$message=$confirmIdle}
    $answer=[Windows.Forms.MessageBox]::Show($message,'Android Agent',[Windows.Forms.MessageBoxButtons]::YesNo,[Windows.Forms.MessageBoxIcon]::Warning)
    if($answer -eq [Windows.Forms.DialogResult]::Yes){Emit 'quit-confirmed'}
   } elseif($command.command -eq 'open-home-failed'){
    $notify.BalloonTipTitle='Android Agent'
    $notify.BalloonTipText=[string]$command.message
    $notify.BalloonTipIcon=[Windows.Forms.ToolTipIcon]::Warning
    $notify.ShowBalloonTip(5000)
   } elseif($command.command -eq 'dispose'){
    $notify.Visible=$false
    Emit 'disposed'
    [Windows.Forms.Application]::Exit()
   }
  } catch { Emit 'error' $_.Exception.Message }
 }
})
$timer.Start()
[Windows.Forms.Application]::Run()
$timer.Stop()
$timer.Dispose()
$notify.Visible=$false
$notify.Icon.Dispose()
$notify.Dispose()
$menu.Dispose()
