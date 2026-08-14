# Restores the most recent install.ps1 backup (undoes the overlay).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\uninstall.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\uninstall.ps1 -ProfileRoot C:\Users\me\.dsh\profiles
param(
    [string]$ProfileRoot = "$env:USERPROFILE\.dsh\profiles"
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$target   = Join-Path $ProfileRoot 'node_modules\@deepseek-ai'

$latest = Get-ChildItem (Join-Path $repoRoot 'backup') -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending | Select-Object -First 1
if ($null -eq $latest) { throw "no backup found under $repoRoot\backup" }

$files = Get-ChildItem $latest.FullName -Recurse -File | ForEach-Object { $_.FullName.Substring($latest.FullName.Length + 1) }
foreach ($rel in $files) {
    Copy-Item (Join-Path $latest.FullName $rel) (Join-Path $target $rel) -Force
    Write-Output "restored: $rel"
}

Write-Output ""
Write-Output "Rolled back to backup $($latest.Name) ($($files.Count) bundles). Restart the DSH server."
