# Portable publisher-secret handoff between Windows hosts.
#
# Windows DPAPI protects scripts/cloud-secret-store.ps1's settings for one
# Windows user on one machine, so a protected store cannot be copied to a new
# publisher PC. The receiving PC creates an RSA key pair (Initialize). The
# sending PC seals its settings and integration credential files to that public
# key (Export). Only the receiving PC's DPAPI-protected private key can open the
# result (Accept), which then re-protects the values for its own Windows user.
#
# Envelope v2: one AES-256-GCM payload whose data key is wrapped with RSA-OAEP
# (SHA-256). The recipient key fingerprint is bound into the authenticated data,
# so an envelope opens only on the PC it was made for. Anyone holding the public
# key can still create an envelope, so both sides print a transfer code computed
# from the plaintext; the operator compares the codes before trusting the result.
#
# No function here prints, logs, or returns a secret value to the console.

Set-StrictMode -Version Latest

$script:HandoffFormat = 'inventory-flow-secret-handoff-v2'
$script:SettingNamePattern = '^[A-Z][A-Z0-9_]{1,90}$'
$script:CredentialFilePattern = '^[a-z0-9][a-z0-9._-]{0,80}\.json$'
# Names that steer process startup, lookup or networking must never ride in a
# store that Run mode exports into the environment before launching node.
$script:ReservedSettingPattern = '^(PATH|PATHEXT|COMSPEC|SYSTEMROOT|SYSTEMDRIVE|WINDIR|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMDATA|PSMODULEPATH|NODE_[A-Z0-9_]*|NPM_[A-Z0-9_]*|PYTHON[A-Z0-9_]*|HTTPS?_PROXY|ALL_PROXY|NO_PROXY|SSL_CERT_[A-Z_]*|DYLD_[A-Z_]*|LD_[A-Z_]*)$'
$script:ReservedDevicePattern = '^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)'
$script:MaxSettings = 64
$script:MaxSettingLength = 8192
$script:MaxFiles = 16
$script:MaxFileBytes = 65536
$script:MinimumRsaBits = 3072

function Get-Sha256Hex([byte[]]$Bytes) {
  return ([Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($Bytes))).ToLowerInvariant()
}

function Clear-Bytes([byte[]]$Bytes) {
  if ($null -ne $Bytes) { [Array]::Clear($Bytes, 0, $Bytes.Length) }
}

function Assert-HandoffContent {
  param([Parameter(Mandatory)][System.Collections.IDictionary]$Settings, [Parameter(Mandatory)][System.Collections.IDictionary]$Files)
  if ($Settings.Count -gt $script:MaxSettings) { throw 'HANDOFF_TOO_MANY_SETTINGS' }
  if ($Files.Count -gt $script:MaxFiles) { throw 'HANDOFF_TOO_MANY_FILES' }
  foreach ($name in $Settings.Keys) {
    if ([string]$name -cnotmatch $script:SettingNamePattern) { throw 'HANDOFF_INVALID_SETTING_NAME' }
    if ([string]$name -match $script:ReservedSettingPattern) { throw 'HANDOFF_RESERVED_SETTING_NAME' }
    $value = $Settings[$name]
    if ($null -eq $value -or ([string]$value).Length -gt $script:MaxSettingLength) { throw 'HANDOFF_INVALID_SETTING_VALUE' }
  }
  foreach ($name in $Files.Keys) {
    if ([string]$name -cnotmatch $script:CredentialFilePattern -or [string]$name -match $script:ReservedDevicePattern) { throw 'HANDOFF_INVALID_FILE_NAME' }
    $bytes = $Files[$name]
    if ($bytes -isnot [byte[]] -or $bytes.Length -eq 0 -or $bytes.Length -gt $script:MaxFileBytes) { throw 'HANDOFF_INVALID_FILE_CONTENT' }
  }
}

function Get-HandoffKeyFingerprint {
  <# Fingerprint of an RSA public key (SubjectPublicKeyInfo, base64). Safe to display. #>
  param([Parameter(Mandatory)][string]$PublicKeyBase64)
  $spki = [Convert]::FromBase64String($PublicKeyBase64.Trim())
  $hex = (Get-Sha256Hex $spki).Substring(0, 16).ToUpperInvariant()
  return 'SHA256:' + (($hex -split '(.{4})' | Where-Object { $_ }) -join '-')
}

function Get-HandoffTransferCode {
  <#
  Order-independent code over the plaintext settings and files. It reveals only
  a truncated hash of per-item hashes. Both PCs print it; matching codes prove
  the receiving PC holds exactly what the sending PC exported.
  #>
  param([Parameter(Mandatory)][System.Collections.IDictionary]$Settings, [Parameter(Mandatory)][System.Collections.IDictionary]$Files)
  $lines = [System.Collections.Generic.List[string]]::new()
  foreach ($name in $Settings.Keys) {
    $valueBytes = [Text.Encoding]::UTF8.GetBytes([string]$Settings[$name])
    try { $lines.Add("setting:${name}:$(Get-Sha256Hex $valueBytes)") } finally { Clear-Bytes $valueBytes }
  }
  foreach ($name in $Files.Keys) { $lines.Add("file:${name}:$(Get-Sha256Hex ([byte[]]$Files[$name]))") }
  $sorted = [string[]]$lines.ToArray()
  [Array]::Sort($sorted, [StringComparer]::Ordinal)
  $hex = (Get-Sha256Hex ([Text.Encoding]::UTF8.GetBytes(($sorted -join "`n")))).Substring(0, 16).ToUpperInvariant()
  return ($hex -split '(.{4})' | Where-Object { $_ }) -join '-'
}

function New-AesGcm([byte[]]$Key) {
  # .NET 8 prefers the explicit tag size; older runtimes only have the key-only constructor.
  try { return [System.Security.Cryptography.AesGcm]::new($Key, 16) } catch { return [System.Security.Cryptography.AesGcm]::new($Key) }
}

function New-SecretHandoff {
  <# Seal settings (name -> string) and credential files (name -> byte[]) to a recipient public key. Returns envelope JSON. #>
  param(
    [Parameter(Mandatory)][System.Collections.IDictionary]$Settings,
    [Parameter(Mandatory)][System.Collections.IDictionary]$Files,
    [Parameter(Mandatory)][string]$PublicKeyBase64
  )
  Assert-HandoffContent -Settings $Settings -Files $Files
  $rsa = [System.Security.Cryptography.RSA]::Create()
  $dataKey = $null; $payload = $null
  try {
    try { $rsa.ImportSubjectPublicKeyInfo([Convert]::FromBase64String($PublicKeyBase64.Trim()), [ref]$null) }
    catch { throw 'HANDOFF_PUBLIC_KEY_INVALID' }
    if ($rsa.KeySize -lt $script:MinimumRsaBits) { throw 'HANDOFF_KEY_TOO_SMALL' }
    $recipient = Get-HandoffKeyFingerprint -PublicKeyBase64 $PublicKeyBase64

    $orderedSettings = [ordered]@{}
    foreach ($name in ([string[]]@($Settings.Keys) | Sort-Object -CaseSensitive)) { $orderedSettings[$name] = [string]$Settings[$name] }
    $orderedFiles = [ordered]@{}
    foreach ($name in ([string[]]@($Files.Keys) | Sort-Object -CaseSensitive)) { $orderedFiles[$name] = [Convert]::ToBase64String([byte[]]$Files[$name]) }
    $payload = [Text.Encoding]::UTF8.GetBytes((@{ settings = $orderedSettings; files = $orderedFiles } | ConvertTo-Json -Compress -Depth 4))

    $dataKey = [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
    $nonce = [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(12)
    $tag = [byte[]]::new(16)
    $ciphertext = [byte[]]::new($payload.Length)
    $aad = [Text.Encoding]::UTF8.GetBytes("$($script:HandoffFormat)|$recipient")
    $aes = New-AesGcm $dataKey
    try { $aes.Encrypt($nonce, $payload, $ciphertext, $tag, $aad) } finally { $aes.Dispose() }
    $wrappedKey = $rsa.Encrypt($dataKey, [System.Security.Cryptography.RSAEncryptionPadding]::OaepSHA256)

    return ([ordered]@{
      format = $script:HandoffFormat
      recipient = $recipient
      createdAt = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
      wrappedKey = [Convert]::ToBase64String($wrappedKey)
      nonce = [Convert]::ToBase64String($nonce)
      tag = [Convert]::ToBase64String($tag)
      ciphertext = [Convert]::ToBase64String($ciphertext)
    } | ConvertTo-Json -Compress)
  } finally {
    Clear-Bytes $dataKey; Clear-Bytes $payload
    $rsa.Dispose()
  }
}

function Read-SecretHandoff {
  <#
  Open an envelope with the recipient's private key. Returns @{ Settings; Files; Format }.
  Also accepts the original v1 handoff (flat map of NAME -> RSA-OAEP chunks, settings only).
  #>
  param([Parameter(Mandatory)][string]$Json, [Parameter(Mandatory)][System.Security.Cryptography.RSA]$PrivateKey)
  try { $envelope = $Json | ConvertFrom-Json -AsHashtable } catch { throw 'HANDOFF_MALFORMED' }
  if ($envelope -isnot [System.Collections.IDictionary]) { throw 'HANDOFF_MALFORMED' }
  $settings = @{}; $files = @{}

  if (@($envelope.Keys) -ccontains 'format') {
    if ($envelope['format'] -cne $script:HandoffFormat) { throw 'HANDOFF_FORMAT_UNSUPPORTED' }
    foreach ($field in 'recipient', 'wrappedKey', 'nonce', 'tag', 'ciphertext') { if (-not $envelope.Contains($field) -or $envelope[$field] -isnot [string]) { throw 'HANDOFF_MALFORMED' } }
    $recipient = Get-HandoffKeyFingerprint -PublicKeyBase64 ([Convert]::ToBase64String($PrivateKey.ExportSubjectPublicKeyInfo()))
    if ($envelope['recipient'] -cne $recipient) { throw 'HANDOFF_NOT_FOR_THIS_PC' }
    $dataKey = $null; $payload = $null
    try {
      try {
        $dataKey = $PrivateKey.Decrypt([Convert]::FromBase64String($envelope.wrappedKey), [System.Security.Cryptography.RSAEncryptionPadding]::OaepSHA256)
        $nonce = [Convert]::FromBase64String($envelope.nonce)
        $tag = [Convert]::FromBase64String($envelope.tag)
        $ciphertext = [Convert]::FromBase64String($envelope.ciphertext)
        $payload = [byte[]]::new($ciphertext.Length)
        $aes = New-AesGcm $dataKey
        try { $aes.Decrypt($nonce, $ciphertext, $tag, $payload, [Text.Encoding]::UTF8.GetBytes("$($script:HandoffFormat)|$recipient")) } finally { $aes.Dispose() }
      } catch { throw 'HANDOFF_DECRYPTION_FAILED' }
      try { $content = [Text.Encoding]::UTF8.GetString($payload) | ConvertFrom-Json -AsHashtable } catch { throw 'HANDOFF_MALFORMED' }
      if ($content -isnot [System.Collections.IDictionary] -or -not $content.Contains('settings') -or -not $content.Contains('files') -or $content['settings'] -isnot [System.Collections.IDictionary] -or $content['files'] -isnot [System.Collections.IDictionary]) { throw 'HANDOFF_MALFORMED' }
      foreach ($name in $content['settings'].Keys) { $settings[$name] = [string]$content['settings'][$name] }
      foreach ($name in $content['files'].Keys) {
        try { $files[$name] = [Convert]::FromBase64String([string]$content['files'][$name]) } catch { throw 'HANDOFF_INVALID_FILE_CONTENT' }
      }
    } finally { Clear-Bytes $dataKey; Clear-Bytes $payload }
    Assert-HandoffContent -Settings $settings -Files $files
    return @{ Settings = $settings; Files = $files; Format = 'v2' }
  }

  # v1: every top-level key is a setting name whose value is a list of RSA-OAEP chunks.
  foreach ($name in $envelope.Keys) {
    if ([string]$name -cnotmatch $script:SettingNamePattern) { throw 'HANDOFF_INVALID_SETTING_NAME' }
    $value = [System.Text.StringBuilder]::new()
    foreach ($part in @($envelope[$name])) {
      try { $bytes = $PrivateKey.Decrypt([Convert]::FromBase64String([string]$part), [System.Security.Cryptography.RSAEncryptionPadding]::OaepSHA256) }
      catch { throw 'HANDOFF_DECRYPTION_FAILED' }
      try { [void]$value.Append([Text.Encoding]::UTF8.GetString($bytes)) } finally { Clear-Bytes $bytes }
    }
    $settings[$name] = $value.ToString()
  }
  Assert-HandoffContent -Settings $settings -Files $files
  return @{ Settings = $settings; Files = $files; Format = 'v1' }
}

function Test-HandoffCredentialFileName {
  param([Parameter(Mandatory)][string]$Name)
  return ($Name -cmatch $script:CredentialFilePattern -and $Name -notmatch $script:ReservedDevicePattern)
}

Export-ModuleMember -Function Get-HandoffKeyFingerprint, Get-HandoffTransferCode, New-SecretHandoff, Read-SecretHandoff, Test-HandoffCredentialFileName
