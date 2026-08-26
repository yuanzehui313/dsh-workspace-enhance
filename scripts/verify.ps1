# Verifies whether the installed DSH bundles still match the overlay, across
# every known bundle tree (profile roots, global install, npx cache,
# DSH Desktop, dsh-pinned).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\verify.ps1
param()

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$overlay  = Join-Path $repoRoot 'overlay'

$dshHome = $env:DSH_HOME; if (-not $dshHome) { $dshHome = Join-Path $env:USERPROFILE '.dsh' }
$trees = @()
$trees += (Join-Path $dshHome 'profiles\node_modules\@deepseek-ai')
Get-ChildItem (Join-Path $dshHome 'profiles') -Directory -ErrorAction SilentlyContinue |
    ForEach-Object { $trees += (Join-Path $_.FullName 'node_modules\@deepseek-ai') }
$trees += (Join-Path $dshHome 'dsh-pinned\node_modules\@deepseek-ai')
$trees += 'C:\nodejs\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai'
Get-ChildItem (Join-Path $env:LOCALAPPDATA 'npm-cache\_npx') -Directory -ErrorAction SilentlyContinue |
    ForEach-Object { $trees += (Join-Path $_.FullName 'node_modules\@deepseek-ai') }
$trees += (Join-Path $env:LOCALAPPDATA 'Programs\DSH Desktop\resources\app.asar.unpacked\node_modules\@deepseek-ai')

$broken = 0
$checked = 0
$files = Get-ChildItem $overlay -Recurse -File | ForEach-Object { $_.FullName.Substring($overlay.Length + 1) }
foreach ($tree in ($trees | Select-Object -Unique)) {
    if (-not (Test-Path $tree)) { continue }
    Write-Output "== $tree =="
    foreach ($rel in $files) {
        $installed = Join-Path $tree $rel
        if (-not (Test-Path $installed)) { continue }
        $checked++
        $h1 = (Get-FileHash $installed -Algorithm SHA256).Hash
        $h2 = (Get-FileHash (Join-Path $overlay $rel) -Algorithm SHA256).Hash
        if ($h1 -eq $h2) { Write-Output "OK      : $rel" }
        else { Write-Output "REVERTED: $rel"; $broken++ }
    }
}
Write-Output ""
if ($broken -eq 0) { Write-Output "All overlay bundles are live ($checked file(s) checked)." }
else { Write-Output "$broken bundle(s) out of date — re-run install.ps1 or node scripts\apply-overlay.mjs."; exit 1 }
