# Installs the dsh-workspace-enhance overlay patch-set into a DeepSeek Harness
# profile. Every replaced bundle is backed up first; uninstall.ps1 restores it.
#
# Usage (PowerShell, full access):
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -ProfileRoot C:\Users\me\.dsh\profiles
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -TargetRoot C:\...\node_modules\@deepseek-ai
#     (terminal/TUI profiles resolve host packages from the dsh CLI install —
#      point -TargetRoot at that install's node_modules\@deepseek-ai instead)
param(
    [string]$ProfileRoot = "$env:USERPROFILE\.dsh\profiles",
    [string]$TargetRoot = ""
)

$ErrorActionPreference = 'Stop'

$repoRoot  = Split-Path -Parent $PSScriptRoot
$overlay   = Join-Path $repoRoot 'overlay'
$target    = if ($TargetRoot -ne "") { $TargetRoot } else { Join-Path $ProfileRoot 'node_modules\@deepseek-ai' }
$backupDir = Join-Path $repoRoot "backup\$(Get-Date -Format 'yyyyMMdd-HHmmss')"

if (-not (Test-Path $target)) { throw "DSH profile not found: $target (pass -ProfileRoot or -TargetRoot)" }

$files = Get-ChildItem $overlay -Recurse -File | ForEach-Object { $_.FullName.Substring($overlay.Length + 1) }

foreach ($rel in $files) {
    $source   = Join-Path $overlay $rel
    $installed = Join-Path $target $rel
    if (-not (Test-Path $installed)) { throw "target bundle missing: $installed (wrong DSH version? this overlay targets @deepseek-ai/dsh 0.1.0-rc.6)" }
    $backup   = Join-Path $backupDir $rel
    New-Item -ItemType Directory -Path (Split-Path $backup) -Force | Out-Null
    Copy-Item $installed $backup -Force
    Copy-Item $source $installed -Force
    Write-Output "patched : $rel"
}

Write-Output ""
Write-Output "Overlay installed ($($files.Count) bundles). Backup: $backupDir"
Write-Output "Restart the DSH server and hard-refresh the GUI (Ctrl+Shift+R)."
Write-Output "Rollback: powershell -ExecutionPolicy Bypass -File scripts\uninstall.ps1"
