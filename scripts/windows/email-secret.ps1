param(
 [Parameter(Mandatory=$true)][ValidateSet('protect','unprotect')][string]$Action
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$inputValue=[Console]::In.ReadToEnd()
if([string]::IsNullOrEmpty($inputValue)){throw 'SECRET_INPUT_REQUIRED'}
$scope=[Security.Cryptography.DataProtectionScope]::CurrentUser
if($Action-eq 'protect'){
 $plain=[Text.Encoding]::UTF8.GetBytes($inputValue)
 try{$protected=[Security.Cryptography.ProtectedData]::Protect($plain,$null,$scope);[Console]::Out.Write([Convert]::ToBase64String($protected))}
 finally{[Array]::Clear($plain,0,$plain.Length)}
}else{
 $protected=[Convert]::FromBase64String($inputValue)
 $plain=[Security.Cryptography.ProtectedData]::Unprotect($protected,$null,$scope)
 try{[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))}
 finally{[Array]::Clear($plain,0,$plain.Length)}
}
