param(
  [Parameter(Mandatory)][ValidateSet('Initialize','Accept','Run')][string]$Mode,
  [string]$InputPath,
  [string]$Script,
  [string[]]$ScriptArguments = @()
)
$ErrorActionPreference = 'Stop'
$appRoot = Split-Path $PSScriptRoot -Parent
$secretDirectory = Join-Path $appRoot 'runtime\cloud-secrets'
$privatePath = Join-Path $secretDirectory 'handoff-private.dpapi'
$storePath = Join-Path $secretDirectory 'publisher.dpapi'
New-Item -ItemType Directory -Force -Path $secretDirectory | Out-Null
if (-not $IsWindows) { throw 'This secret store requires Windows current-user protection.' }
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$acl = Get-Acl -LiteralPath $secretDirectory
if (-not $acl.AreAccessRulesProtected) {
  $acl.SetAccessRuleProtection($true, $false)
  $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
  $acl.SetAccessRule($rule)
  Set-Acl -LiteralPath $secretDirectory -AclObject $acl
}
function Protect-Local([string]$value) { ConvertFrom-SecureString (ConvertTo-SecureString $value -AsPlainText -Force) }
function Unprotect-Local([string]$value) { [System.Net.NetworkCredential]::new('',(ConvertTo-SecureString $value)).Password }
if ($Mode -eq 'Initialize') {
  if (Test-Path -LiteralPath $privatePath) { throw 'A handoff key already exists; reuse its public key.' }
  $rsa = [System.Security.Cryptography.RSA]::Create(4096)
  try {
    [IO.File]::WriteAllText($privatePath,(Protect-Local ([Convert]::ToBase64String($rsa.ExportPkcs8PrivateKey()))))
    $public = [Convert]::ToBase64String($rsa.ExportSubjectPublicKeyInfo())
    [IO.File]::WriteAllText((Join-Path $secretDirectory 'handoff-public.txt'),$public)
    Write-Output $public
  } finally { $rsa.Dispose() }
  exit
}
if ($Mode -eq 'Accept') {
  $rsa = [System.Security.Cryptography.RSA]::Create()
  try {
    $keyBytes = [Convert]::FromBase64String((Unprotect-Local ([IO.File]::ReadAllText($privatePath))))
    $rsa.ImportPkcs8PrivateKey($keyBytes,[ref]$null)
    [Array]::Clear($keyBytes,0,$keyBytes.Length)
    $values = @{}
    if (Test-Path -LiteralPath $storePath) { $values = (Unprotect-Local ([IO.File]::ReadAllText($storePath))) | ConvertFrom-Json -AsHashtable }
    $handoff = Get-Content -LiteralPath $InputPath -Raw | ConvertFrom-Json -AsHashtable
    foreach ($name in $handoff.Keys) {
      if ($name -notmatch '^[A-Z][A-Z0-9_]{1,90}$') { throw 'Invalid secret name.' }
      $parts = @($handoff[$name])
      $value = ''
      foreach ($part in $parts) {
        $bytes = $rsa.Decrypt([Convert]::FromBase64String($part),[System.Security.Cryptography.RSAEncryptionPadding]::OaepSHA256)
        $value += [Text.Encoding]::UTF8.GetString($bytes)
        [Array]::Clear($bytes,0,$bytes.Length)
      }
      $values[$name] = $value
    }
    [IO.File]::WriteAllText($storePath,(Protect-Local ($values | ConvertTo-Json -Compress)))
    Write-Output 'Encrypted settings received and protected for this Windows user.'
  } finally { $rsa.Dispose() }
  exit
}
$settings = (Unprotect-Local ([IO.File]::ReadAllText($storePath))) | ConvertFrom-Json -AsHashtable
$original = @{}
try {
  foreach ($name in $settings.Keys) { $original[$name]=[Environment]::GetEnvironmentVariable($name); [Environment]::SetEnvironmentVariable($name,$settings[$name]) }
  & node $Script @ScriptArguments
  if ($LASTEXITCODE -ne 0) { throw 'Cloud operation did not complete.' }
} finally {
  foreach ($name in $settings.Keys) { [Environment]::SetEnvironmentVariable($name,$original[$name]) }
}
