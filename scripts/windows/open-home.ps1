[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $HomeUrl
)

$ErrorActionPreference = 'Stop'
$uri = $null
if (-not [Uri]::TryCreate($HomeUrl, [UriKind]::Absolute, [ref] $uri) -or
    $uri.Scheme -ne 'http' -or
    $uri.Host -ne '127.0.0.1' -or
    -not [string]::IsNullOrEmpty($uri.UserInfo) -or
    $uri.AbsolutePath -ne '/' -or
    -not [string]::IsNullOrEmpty($uri.Query) -or
    -not [string]::IsNullOrEmpty($uri.Fragment)) {
    throw 'HomeUrl must be a plain loopback HTTP URL.'
}

try {
    # Use the Windows HTTP association, not a console-owned process.
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $uri.AbsoluteUri
    $info.UseShellExecute = $true
    [void][System.Diagnostics.Process]::Start($info)
    [Console]::Out.WriteLine('HOME_OPENED')
} catch {
    [Console]::Error.WriteLine('Unable to open the default browser: ' + $_.Exception.Message)
    exit 1
}
