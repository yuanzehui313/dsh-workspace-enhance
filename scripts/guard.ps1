# dsh-workspace-enhance patch guard: keeps the overlay applied GLOBALLY.
#
# Verifies every overlay bundle against every target tree and silently
# re-applies (delete + copy, hardlink-breaking) anything that reverted. Runs
# as a scheduled task so the workspace enhancements stay active across DSH /
# desktop restarts and package refreshes — only uninstall.ps1 reverts them.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File guard.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File guard.ps1 -Overlay D:\repo\overlay -Trees @("C:\...\node_modules\@deepseek-ai")
param(
    [string]$Overlay = "",
    [string[]]$Trees = @(),
    [string]$LogPath = ""
)

$ErrorActionPreference = 'SilentlyContinue'

$repoRoot = Split-Path -Parent $PSScriptRoot
if ($Overlay -eq "") { $Overlay = Join-Path $repoRoot 'overlay' }
if ($Trees.Count -eq 0) {
    $Trees = @(
        "$env:USERPROFILE\.dsh\profiles\node_modules\@deepseek-ai",
        "C:\nodejs\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai",
        "$env:USERPROFILE\AppData\Local\npm-cache\_npx\1e7f6d9597241db0\node_modules\@deepseek-ai",
        "$env:USERPROFILE\.dsh\dsh-pinned\node_modules\@deepseek-ai",
        "$env:USERPROFILE\AppData\Local\Programs\DSH Desktop\resources\app.asar.unpacked\node_modules\@deepseek-ai"
    )
}
if ($LogPath -eq "") { $LogPath = Join-Path $repoRoot 'guard.log' }

function Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg"
    Add-Content -Path $LogPath -Value $line
}

if (-not (Test-Path $Overlay)) {
    Log "guard: overlay not found at $Overlay — nothing to do"
    exit 0
}

$files = Get-ChildItem $Overlay -Recurse -File | ForEach-Object { $_.FullName.Substring($Overlay.Length + 1) }
$reapplied = 0
$checked = 0

foreach ($tree in $Trees) {
    if (-not (Test-Path $tree)) { continue }
    foreach ($rel in $files) {
        $target = Join-Path $tree $rel
        if (-not (Test-Path $target)) { continue }
        $checked++
        $h1 = (Get-FileHash $target -Algorithm SHA256).Hash
        $h2 = (Get-FileHash (Join-Path $Overlay $rel) -Algorithm SHA256).Hash
        if ($h1 -ne $h2) {
            Remove-Item $target -Force
            Copy-Item (Join-Path $Overlay $rel) $target -Force
            $reapplied++
            Log "re-applied: $tree\$rel"
        }
    }
}

if ($reapplied -gt 0) {
    Log "guard: re-applied $reapplied bundle(s) ($checked checked)"
} else {
    Log "guard: all $checked bundle(s) intact"
}
