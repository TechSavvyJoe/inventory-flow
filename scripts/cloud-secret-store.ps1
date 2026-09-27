param(
  [Parameter(Mandatory)][ValidateSet('Initialize','Accept','Export','Check','Run')][string]$Mode,
  [string]$InputPath,
  [string]$PublicKeyPath,
  [string]$OutputPath,
  [string]$Script,
  [string[]]$ScriptArguments = @()
)
$ErrorActionPreference = 'Stop'
$appRoot = Split-Path $PSScriptRoot -Parent
$secretDirectory = Join-Path $appRoot 'runtime\cloud-secrets'
$credentialDirectory = Join-Path $appRoot 'runtime\integration-credentials'
$privatePath = Join-Path $secretDirectory 'handoff-private.dpapi'
$storePath = Join-Path $secretDirectory 'publisher.dpapi'
if (-not $IsWindows) { throw 'This secret store requires Windows current-user protection.' }
Import-Module (Join-Path $PSScriptRoot 'lib\secret-handoff.psm1') -Force
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
function Protect-Directory([string]$path) {
  New-Item -ItemType Directory -Force -Path $path | Out-Null
  $acl = Get-Acl -LiteralPath $path
  if (-not $acl.AreAccessRulesProtected) {
    $acl.SetAccessRuleProtection($true, $false)
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
    $acl.SetAccessRule($rule)
    Set-Acl -LiteralPath $path -AclObject $acl
  }
}
Protect-Directory $secretDirectory
function Protect-Local([string]$value) { ConvertFrom-SecureString (ConvertTo-SecureString $value -AsPlainText -Force) }
function Unprotect-Local([string]$value) { [System.Net.NetworkCredential]::new('',(ConvertTo-SecureString $value)).Password }
function Read-Store {
  if (-not (Test-Path -LiteralPath $storePath)) { return @{} }
  return (Unprotect-Local ([IO.File]::ReadAllText($storePath))) | ConvertFrom-Json -AsHashtable
}
function Read-CredentialFiles {
  # Integration credential files are host-local like the store; only portable names travel.
  $files = @{}; $skipped = @()
  if (Test-Path -LiteralPath $credentialDirectory) {
    foreach ($item in Get-ChildItem -LiteralPath $credentialDirectory -File -Filter '*.json') {
      if ($item.Name -cmatch '^[a-z0-9][a-z0-9._-]{0,80}\.json$') { $files[$item.Name] = [IO.File]::ReadAllBytes($item.FullName) }
      else { $skipped += $item.Name }
    }
  }
  return @{ Files = $files; Skipped = $skipped }
}
function Write-Summary([System.Collections.IDictionary]$settings, [System.Collections.IDictionary]$files) {
  $settingNames = @($settings.Keys | Sort-Object -CaseSensitive)
  $fileNames = @($files.Keys | Sort-Object -CaseSensitive)
  Write-Output ("Settings: {0} ({1})" -f $settingNames.Count, ($settingNames -join ', '))
  Write-Output ("Credential files: {0} ({1})" -f $fileNames.Count, ($fileNames -join ', '))
  Write-Output ("Transfer code: {0}" -f (Get-HandoffTransferCode -Settings $settings -Files $files))
}
if ($Mode -eq 'Initialize') {
  if (Test-Path -LiteralPath $privatePath) { throw 'A handoff key already exists; reuse its public key in runtime\cloud-secrets\handoff-public.txt.' }
  $rsa = [System.Security.Cryptography.RSA]::Create(4096)
  try {
    [IO.File]::WriteAllText($privatePath,(Protect-Local ([Convert]::ToBase64String($rsa.ExportPkcs8PrivateKey()))))
    $public = [Convert]::ToBase64String($rsa.ExportSubjectPublicKeyInfo())
    [IO.File]::WriteAllText((Join-Path $secretDirectory 'handoff-public.txt'),$public)
    Write-Output $public
    Write-Host ("Recipient key fingerprint: {0}" -f (Get-HandoffKeyFingerprint -PublicKeyBase64 $public))
  } finally { $rsa.Dispose() }
  exit
}
if ($Mode -eq 'Export') {
  # Run on the current publisher PC. Seals this Windows user's settings and
  # integration credential files to the receiving PC's public key.
  if (-not $PublicKeyPath -or -not $OutputPath) { throw 'Export requires -PublicKeyPath and -OutputPath.' }
  if (-not (Test-Path -LiteralPath $storePath)) { throw 'SECRET_STORE_MISSING' }
  $separator = [IO.Path]::DirectorySeparatorChar
  $outputFull = [IO.Path]::GetFullPath($OutputPath)
  $appFull = [IO.Path]::GetFullPath($appRoot).TrimEnd('\','/') + $separator
  $runtimeFull = [IO.Path]::GetFullPath((Join-Path $appRoot 'runtime')).TrimEnd('\','/') + $separator
  if ($outputFull.StartsWith($appFull, [StringComparison]::OrdinalIgnoreCase) -and -not $outputFull.StartsWith($runtimeFull, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'HANDOFF_OUTPUT_INSIDE_REPOSITORY: write the handoff outside the repository or under runtime\.'
  }
  $publicKey = ([IO.File]::ReadAllText([IO.Path]::GetFullPath($PublicKeyPath))).Trim()
  $settings = Read-Store
  $credentials = Read-CredentialFiles
  $json = New-SecretHandoff -Settings $settings -Files $credentials.Files -PublicKeyBase64 $publicKey
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $stream = [IO.File]::Open($outputFull, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
  Write-Output ("Sealed for recipient key {0}" -f (Get-HandoffKeyFingerprint -PublicKeyBase64 $publicKey))
  Write-Summary $settings $credentials.Files
  foreach ($name in $credentials.Skipped) { Write-Output ("Skipped credential file with a non-portable name: {0}" -f $name) }
  Write-Output 'Move the handoff file to the receiving PC and run -Mode Accept there. Delete it from both PCs afterward.'
  exit
}
if ($Mode -eq 'Accept') {
  if (-not $InputPath) { throw 'Accept requires -InputPath.' }
  if (-not (Test-Path -LiteralPath $privatePath)) { throw 'HANDOFF_KEY_MISSING: run -Mode Initialize on this PC first.' }
  $rsa = [System.Security.Cryptography.RSA]::Create()
  try {
    $keyBytes = [Convert]::FromBase64String((Unprotect-Local ([IO.File]::ReadAllText($privatePath))))
    try { $rsa.ImportPkcs8PrivateKey($keyBytes,[ref]$null) } finally { [Array]::Clear($keyBytes,0,$keyBytes.Length) }
    $received = Read-SecretHandoff -Json (Get-Content -LiteralPath $InputPath -Raw) -PrivateKey $rsa
    # Refuse to replace a different credential file before anything is written.
    foreach ($name in $received.Files.Keys) {
      $target = Join-Path $credentialDirectory $name
      if ((Test-Path -LiteralPath $target) -and [Convert]::ToBase64String([IO.File]::ReadAllBytes($target)) -cne [Convert]::ToBase64String([byte[]]$received.Files[$name])) {
        throw ("CREDENTIAL_FILE_EXISTS: {0} already exists with different content; move it aside first." -f $name)
      }
    }
    $values = Read-Store
    foreach ($name in $received.Settings.Keys) { $values[$name] = $received.Settings[$name] }
    [IO.File]::WriteAllText($storePath,(Protect-Local ($values | ConvertTo-Json -Compress)))
    if ($received.Files.Count) {
      Protect-Directory $credentialDirectory
      foreach ($name in $received.Files.Keys) { [IO.File]::WriteAllBytes((Join-Path $credentialDirectory $name), [byte[]]$received.Files[$name]) }
    }
    Write-Output 'Encrypted settings received and protected for this Windows user.'
    Write-Summary $received.Settings $received.Files
    Write-Output 'Compare the transfer code with the sending PC. If it differs, stop and repeat the transfer. Delete the handoff file from both PCs.'
  } finally { $rsa.Dispose() }
  exit
}
if ($Mode -eq 'Check') {
  # Prints names and a transfer code only. Matching codes on two PCs mean they hold the same values.
  $credentials = Read-CredentialFiles
  Write-Summary (Read-Store) $credentials.Files
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
