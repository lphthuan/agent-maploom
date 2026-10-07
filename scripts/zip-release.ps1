param([Parameter(Mandatory=$true)][string]$Source, [Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$sourcePath = [IO.Path]::GetFullPath($Source)
$destinationPath = [IO.Path]::GetFullPath($Destination)
if (-not (Test-Path -LiteralPath $sourcePath -PathType Container)) { throw 'Release staging directory is missing.' }
if (Test-Path -LiteralPath $destinationPath) { throw 'Refusing to overwrite an existing archive in the temporary build.' }
[IO.Compression.ZipFile]::CreateFromDirectory($sourcePath, $destinationPath, [IO.Compression.CompressionLevel]::Optimal, $false)
