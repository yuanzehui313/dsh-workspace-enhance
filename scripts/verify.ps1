# Verifies whether the installed DSH bundles still match the overlay.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\verify.ps1
param(
    [string]$ProfileRoot = "$env:USERPROFILE\.dsh\profiles"
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$overlay  = Join-Path $repoRoot 'overlay'
$target   = Join-Path $ProfileRoot 'node_modules\@deepseek-ai'

$broken = 0
$files = Get-ChildItem $overlay -Recurse -File | ForEach-Object { $_.FullName.Substring($overlay.Length + 1) }
foreach ($rel in $files) {
    $installed = Join-Path $target $rel
    if (-not (Test-Path $installed)) { Write-Output "MISSING : $rel"; $broken++; continue }
    $h1 = (Get-FileHash $installed -Algorithm SHA256).Hash
    $h2 = (Get-FileHash (Join-Path $overlay $rel) -Algorithm SHA256).Hash
    if ($h1 -eq $h2) { Write-Output "OK      : $rel" }
    else { Write-Output "REVERTED: $rel"; $broken++ }
}
Write-Output ""
if ($broken -eq 0) { Write-Output "All $($files.Count) overlay bundles are live." }
else { Write-Output "$broken bundle(s) out of date — re-run install.ps1."; exit 1 }
