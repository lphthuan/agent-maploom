$ErrorActionPreference = 'Stop'
$toolkitNode = Get-Command node.exe -ErrorAction SilentlyContinue
$nodeCandidates = @()
if ($toolkitNode) { $nodeCandidates += $toolkitNode.Source }
$nodeCandidates += Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$nodeCandidates += Join-Path $PSScriptRoot '.cache\runtime\node-v24.19.0-win-x64\node.exe'
$nodeCandidates += Join-Path $PSScriptRoot '.cache\runtime\node-v24.19.0-win-arm64\node.exe'
$toolkitNodePath = $null
foreach ($candidate in $nodeCandidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
        $reportedVersion = & $candidate --version
        if ($LASTEXITCODE -eq 0 -and $reportedVersion -match '^v(\d+)\.' -and [int]$Matches[1] -ge 24) { $toolkitNodePath = $candidate; break }
    }
}
if (-not $toolkitNodePath) { throw 'Node 24+ is required. Run bootstrap.ps1.' }
& $toolkitNodePath (Join-Path $PSScriptRoot 'bin\agent-maploom.mjs') @args
exit $LASTEXITCODE
