[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

function Convert-SecureStringToPlainText {
  param([securestring]$Value)

  if ($null -eq $Value) {
    return ""
  }

  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

$secureApiKey = Read-Host "MiniMax API Key" -AsSecureString
$voiceId = Read-Host "MiniMax verification voice_id (optional)"

try {
  $env:MINIMAX_API_KEY_INPUT = Convert-SecureStringToPlainText $secureApiKey
  $env:MINIMAX_VERIFICATION_VOICE_ID_INPUT = $voiceId

  pnpm secrets:minimax:save
} finally {
  Remove-Item Env:MINIMAX_API_KEY_INPUT -ErrorAction SilentlyContinue
  Remove-Item Env:MINIMAX_VERIFICATION_VOICE_ID_INPUT -ErrorAction SilentlyContinue
}
