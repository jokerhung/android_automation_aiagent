param(
  [Parameter(Mandatory = $true)]
  [string]$Target,
  [Parameter(Mandatory = $true)]
  [ValidateSet('File', 'Directory')]
  [string]$Kind,
  [Parameter(Mandatory = $true)]
  [ValidateSet('True', 'False')]
  [string]$AllowSystem
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$item = Get-Item -LiteralPath $Target -Force -ErrorAction Stop
$isDirectory = $Kind -eq 'Directory'
if ($isDirectory -ne [bool]$item.PSIsContainer) {
  throw "ACL target kind does not match: $Target"
}

$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
if ($null -eq $currentSid) { throw 'Unable to resolve current Windows SID' }
$systemSid = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')
$includeSystem = $AllowSystem -eq 'True'

if ($isDirectory) {
  $security = New-Object System.Security.AccessControl.DirectorySecurity
  $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
} else {
  $security = New-Object System.Security.AccessControl.FileSecurity
  $inheritance = [System.Security.AccessControl.InheritanceFlags]::None
}
$propagation = [System.Security.AccessControl.PropagationFlags]::None
$allow = [System.Security.AccessControl.AccessControlType]::Allow
$fullControl = [System.Security.AccessControl.FileSystemRights]::FullControl

$security.SetAccessRuleProtection($true, $false)
$security.SetOwner($currentSid)
$security.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($currentSid, $fullControl, $inheritance, $propagation, $allow)))
if ($includeSystem) {
  $security.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($systemSid, $fullControl, $inheritance, $propagation, $allow)))
}
# Persist only the sections modified above (DACL and owner). Windows PowerShell's
# Set-Acl provider can request audit/SACL access, requiring SeSecurityPrivilege
# even though this helper never changes audit rules. Do not elevate or relax ACLs.
$sections = [System.Security.AccessControl.AccessControlSections]::Access -bor [System.Security.AccessControl.AccessControlSections]::Owner
if ($isDirectory) {
  [System.IO.Directory]::SetAccessControl($item.FullName, $security)
  $actual = [System.IO.Directory]::GetAccessControl($item.FullName, $sections)
} else {
  [System.IO.File]::SetAccessControl($item.FullName, $security)
  $actual = [System.IO.File]::GetAccessControl($item.FullName, $sections)
}
if (-not $actual.AreAccessRulesProtected) { throw 'ACL inheritance remains enabled' }
$ownerSid = $actual.GetOwner([System.Security.Principal.SecurityIdentifier])
if ($ownerSid.Value -ne $currentSid.Value) { throw "Unexpected ACL owner: $($ownerSid.Value)" }

$allowed = @($currentSid.Value)
if ($includeSystem) { $allowed += $systemSid.Value }
$seen = @{}
$rules = $actual.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])
foreach ($rule in $rules) {
  $sid = $rule.IdentityReference.Value
  if ($rule.IsInherited) { throw "Inherited ACE remains for $sid" }
  if ($allowed -notcontains $sid) { throw "Unexpected ACE remains for $sid" }
  if ($rule.AccessControlType -ne $allow) { throw "Unexpected deny ACE remains for $sid" }
  if (($rule.FileSystemRights -band $fullControl) -ne $fullControl) { throw "ACE is not FullControl for $sid" }
  if ($rule.InheritanceFlags -ne $inheritance -or $rule.PropagationFlags -ne $propagation) { throw "Unexpected ACE flags for $sid" }
  $seen[$sid] = $true
}
foreach ($sid in $allowed) {
  if (-not $seen.ContainsKey($sid)) { throw "Required ACE is missing for $sid" }
}
if ($rules.Count -ne $allowed.Count) { throw 'ACL contains duplicate or unexpected rules' }

[pscustomobject]@{
  ok = $true
  owner = $ownerSid.Value
  currentSid = $currentSid.Value
  systemAllowed = $includeSystem
  ruleCount = $rules.Count
} | ConvertTo-Json -Compress
