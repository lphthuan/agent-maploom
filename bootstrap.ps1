param(
    [string]$Config,
    [string]$Project,
    [string]$Workspace,
    [ValidateSet('basic', 'full')][string]$Mode,
    [switch]$Attach,
    [switch]$NoAttach,
    [switch]$SkipHelpers,
    [switch]$Offline
)
$ErrorActionPreference = 'Stop'
$toolkitDirectory = $PSScriptRoot
$runtimeDirectory = Join-Path $toolkitDirectory '.cache\runtime'
$nodeVersion = '24.19.0'
$pnpmVersion = '11.19.0'
if ($Project) { $Project = [IO.Path]::GetFullPath($Project) }
if ($Config) { $Config = [IO.Path]::GetFullPath($Config) }
if ($Workspace) { $Workspace = [IO.Path]::GetFullPath($Workspace) }

function Invoke-NodeChecked {
    param([string[]]$Arguments)
    & $script:toolkitNode @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Command failed (exit $LASTEXITCODE). See output above." }
}

$nodeCandidates = @()
$pathNode = Get-Command node.exe -ErrorAction SilentlyContinue
if ($pathNode) { $nodeCandidates += $pathNode.Source }
$nodeCandidates += Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$nodeCandidates += Join-Path $runtimeDirectory "node-v$nodeVersion-win-x64\node.exe"
$nodeCandidates += Join-Path $runtimeDirectory "node-v$nodeVersion-win-arm64\node.exe"
$toolkitNode = $null
foreach ($candidate in $nodeCandidates) {
    if (Test-Path -LiteralPath $candidate) {
        $reportedVersion = & $candidate --version
        if ($LASTEXITCODE -eq 0 -and $reportedVersion -match '^v(\d+)\.' -and [int]$Matches[1] -ge 24) {
            $toolkitNode = $candidate
            break
        }
    }
}
if (-not $toolkitNode) {
    if ($Offline) { throw 'Node >=24 is required. Offline mode cannot download it.' }
    $architecture = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
    $archiveName = "node-v$nodeVersion-win-$architecture.zip"
    $expectedHash = if ($architecture -eq 'arm64') { '8502f4a50b458d4cc38ed8f2001556c2cd239d464920f74017926ccb1e1c157f' } else { '57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73' }
    New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
    $archivePath = Join-Path $runtimeDirectory $archiveName
    Write-Host "Downloading official Node $nodeVersion ($architecture)..."
    Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/v$nodeVersion/$archiveName" -OutFile $archivePath
    if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) { throw 'Node archive checksum mismatch.' }
    & (Join-Path $toolkitDirectory 'src\adapters\extract-zip.ps1') -Source $archivePath -Destination $runtimeDirectory
    $toolkitNode = Join-Path $runtimeDirectory "node-v$nodeVersion-win-$architecture\node.exe"
}

$nodeDirectory = Split-Path -Parent $toolkitNode
$pmCandidates = @(
    (Join-Path (Split-Path -Parent $nodeDirectory) 'node_modules\pnpm\bin\pnpm.cjs'),
    (Join-Path $runtimeDirectory 'package-manager\node_modules\pnpm\bin\pnpm.cjs')
)
$packageManagerEntry = $null
foreach ($candidate in $pmCandidates) {
    if (Test-Path -LiteralPath $candidate) {
        $pmVersion = & $toolkitNode $candidate --version
        if ($LASTEXITCODE -eq 0 -and $pmVersion -eq $pnpmVersion) { $packageManagerEntry = $candidate; break }
    }
}
if (-not $packageManagerEntry) {
    if ($Offline) { throw "pnpm $pnpmVersion is required for the frozen lockfile." }
    $npmEntry = Join-Path $nodeDirectory 'node_modules\npm\bin\npm-cli.js'
    if (-not (Test-Path -LiteralPath $npmEntry)) { throw 'npm entrypoint missing; use a standard Node installation with npm.' }
    $pmDirectory = Join-Path $runtimeDirectory 'package-manager'
    Invoke-NodeChecked -Arguments @($npmEntry, 'install', '--prefix', $pmDirectory, "pnpm@$pnpmVersion", '--ignore-scripts', '--no-audit', '--no-fund')
    $packageManagerEntry = Join-Path $pmDirectory 'node_modules\pnpm\bin\pnpm.cjs'
}

Push-Location -LiteralPath $toolkitDirectory
try {
    $installArguments = @($packageManagerEntry, 'install', '--frozen-lockfile', '--ignore-scripts', '--store-dir', (Join-Path $toolkitDirectory '.cache\pnpm-store'))
    if ($Offline) { $installArguments += '--offline' }
    Invoke-NodeChecked -Arguments $installArguments
    Invoke-NodeChecked -Arguments @((Join-Path $toolkitDirectory 'node_modules\typescript\bin\tsc'), '--noEmit')
    $common = @()
    if ($Config) { $common += @('--config', $Config) }
    if ($Project) { $common += @('--project', $Project) }
    if ($Workspace) { $common += @('--workspace', $Workspace) }
    if ($Attach -and $NoAttach) { throw 'Choose -Attach or -NoAttach.' }
    if ($Mode -or $SkipHelpers) {
        $initArguments = @((Join-Path $toolkitDirectory 'src\cli.ts'), 'init') + $common
        if (-not $NoAttach) { $initArguments += '--attach' }
        if ($Mode) { $initArguments += @('--mode', $Mode) }
        Invoke-NodeChecked -Arguments $initArguments
    }
    if (-not $SkipHelpers) {
        $setupArguments = @((Join-Path $toolkitDirectory 'src\cli.ts'), 'setup', '--apply') + $common
        if ($NoAttach) { $setupArguments += '--no-attach' }
        if ($Offline) { $setupArguments += '--offline' }
        Invoke-NodeChecked -Arguments $setupArguments
    }
    Invoke-NodeChecked -Arguments (@((Join-Path $toolkitDirectory 'src\cli.ts'), 'doctor', '--offline') + $common)
    Write-Host 'Bootstrap complete. Run agent-maploom.ps1 context / verify / checkpoint with the same config.'
}
finally { Pop-Location }
