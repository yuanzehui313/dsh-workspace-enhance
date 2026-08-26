# Installs the dsh-workspace-enhance overlay patch-set into every known
# DeepSeek Harness bundle tree (profile roots, global install, npx cache,
# DSH Desktop, dsh-pinned). Canonical logic lives in scripts/apply-overlay.mjs
# (idempotent, version-guarded, backs up every replaced file first).
#
# Usage (PowerShell, full access):
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -ProfileRoot C:\Users\me\.dsh\profiles
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -Trees @("C:\...\node_modules\@deepseek-ai")
param(
    [string]$ProfileRoot = "",
    [string[]]$Trees = @()
)

$ErrorActionPreference = 'Stop'

$repoRoot  = Split-Path -Parent $PSScriptRoot
$node      = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $node) { throw "node not found in PATH — install Node.js, or apply the overlay manually" }

$nodeArgs = @()
if ($ProfileRoot -ne "") { $nodeArgs += @('--tree', (Join-Path $ProfileRoot 'node_modules\@deepseek-ai')) }
foreach ($t in $Trees) { $nodeArgs += @('--tree', $t) }

& $node.Source (Join-Path $repoRoot 'scripts\apply-overlay.mjs') @nodeArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Output ""
Write-Output "Restart the DSH server and hard-refresh the GUI (Ctrl+Shift+R)."
Write-Output "Rollback: powershell -ExecutionPolicy Bypass -File scripts\uninstall.ps1"
