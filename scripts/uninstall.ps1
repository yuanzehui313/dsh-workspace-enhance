# Restores the most recent overlay backup (undoes the patch-set) in every
# known DSH bundle tree.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\uninstall.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\uninstall.ps1 -ProfileRoot C:\Users\me\.dsh\profiles
param(
    [string]$ProfileRoot = ""
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot

$latest = Get-ChildItem (Join-Path $repoRoot 'backup') -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending | Select-Object -First 1
if ($null -eq $latest) { throw "no backup found under $repoRoot\backup" }

# Candidate bundle trees (mirror scripts/apply-overlay.mjs)
$trees = @()
if ($ProfileRoot -ne "") {
    $trees += (Join-Path $ProfileRoot 'node_modules\@deepseek-ai')
} else {
    $dshHome = $env:DSH_HOME; if (-not $dshHome) { $dshHome = Join-Path $env:USERPROFILE '.dsh' }
    $trees += (Join-Path $dshHome 'profiles\node_modules\@deepseek-ai')
    Get-ChildItem (Join-Path $dshHome 'profiles') -Directory -ErrorAction SilentlyContinue |
        ForEach-Object { $trees += (Join-Path $_.FullName 'node_modules\@deepseek-ai') }
    $trees += (Join-Path $dshHome 'dsh-pinned\node_modules\@deepseek-ai')
    $trees += 'C:\nodejs\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai'
    Get-ChildItem (Join-Path $env:LOCALAPPDATA 'npm-cache\_npx') -Directory -ErrorAction SilentlyContinue |
        ForEach-Object { $trees += (Join-Path $_.FullName 'node_modules\@deepseek-ai') }
    $trees += (Join-Path $env:LOCALAPPDATA 'Programs\DSH Desktop\resources\app.asar.unpacked\node_modules\@deepseek-ai')
}

$files = Get-ChildItem $latest.FullName -Recurse -File | ForEach-Object { $_.FullName.Substring($latest.FullName.Length + 1) }
$restored = 0
foreach ($rel in $files) {
    foreach ($tree in ($trees | Select-Object -Unique)) {
        if (-not (Test-Path $tree)) { continue }
        $target = Join-Path $tree $rel
        if (-not (Test-Path $target)) { continue }
        Copy-Item (Join-Path $latest.FullName $rel) $target -Force
        Write-Output "restored: $rel"
        $restored++
    }
}

Write-Output ""
Write-Output "Rolled back to backup $($latest.Name) ($restored file(s) restored). Restart the DSH server."
