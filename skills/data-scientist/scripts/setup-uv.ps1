[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# Verification only; installation and upgrades are separate package-manager actions.
if ($null -ne (Get-Command uv -ErrorAction SilentlyContinue)) {
    & uv --version
    exit $LASTEXITCODE
}
if ($env:LAZYNEON_OFFLINE -eq '1') {
    Write-Host '[setup-uv] offline: uv missing; no download attempted.'
} else {
    Write-Host '[setup-uv] uv missing. Install using winget install --id=astral-sh.uv -e, then rerun.'
}
exit 1
