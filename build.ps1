# Packs the extension into docs/float-video.zip and writes docs/version.json,
# which installed copies check to see if an update is out.
# Run after bumping "version" in manifest.json, then commit and push.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

$version = (Get-Content manifest.json -Raw | ConvertFrom-Json).version
$zipPath = Join-Path $PSScriptRoot 'docs\float-video.zip'
if (Test-Path $zipPath) { Remove-Item $zipPath }

# Files sit at the top of the zip so Windows "Extract All" gives one folder
# with manifest.json directly inside.
$files = @('manifest.json', 'background.js') + (Get-ChildItem icons -File | ForEach-Object { "icons/$($_.Name)" })
$zip = [IO.Compression.ZipFile]::Open($zipPath, 'Create')
try {
  foreach ($f in $files) {
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $PSScriptRoot $f), $f) | Out-Null
  }
} finally {
  $zip.Dispose()
}

Set-Content docs\version.json "{ `"version`": `"$version`" }" -NoNewline
$kb = [math]::Round((Get-Item $zipPath).Length / 1KB)
(Get-Content docs\index.html -Raw) -replace 'v[\d.]+ · \d+ KB', "v$version · $kb KB" | Set-Content docs\index.html -NoNewline
Write-Host "Built v$version ($kb KB)"
