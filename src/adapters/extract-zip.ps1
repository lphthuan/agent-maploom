param([Parameter(Mandatory=$true)][string]$Source, [Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$sourcePath = [IO.Path]::GetFullPath($Source)
$destinationRoot = [IO.Path]::GetFullPath($Destination).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
[IO.Directory]::CreateDirectory($destinationRoot) | Out-Null
$archive = [IO.Compression.ZipFile]::OpenRead($sourcePath)
try {
    foreach ($entry in $archive.Entries) {
        $targetPath = [IO.Path]::GetFullPath([IO.Path]::Combine($destinationRoot, $entry.FullName))
        if (-not $targetPath.StartsWith($destinationRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'ZIP entry escapes the destination.' }
        if (-not $entry.Name) { [IO.Directory]::CreateDirectory($targetPath) | Out-Null; continue }
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($targetPath)) | Out-Null
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $targetPath, $true)
    }
}
finally { $archive.Dispose() }
