# Fetch ffmpeg into this folder. No installer, no administrator.
#
# Preparing video needs ffmpeg: avatar clips are cropped, whitened and
# ping-ponged by conform_footage.py, and an advert recorded on a phone is
# converted to mp4 before a browser will play it. On a machine where nobody can
# run an installer that was a dead end, and every upload came back "ffmpeg is
# not on this machine's PATH".
#
# ffmpeg ships as one self-contained executable. Dropping it here is enough --
# ffmpeg_exe() in conform_footage.py looks in this folder before it gives up.
#
#     powershell -ExecutionPolicy Bypass -File tools\get-ffmpeg.ps1

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = Join-Path $here 'ffmpeg.exe'

if (Test-Path $target) {
    Write-Host "Already here: $target"
    & $target -version | Select-Object -First 1
    exit 0
}

# The essentials build carries the encoders this project uses -- libx264, and
# the filters conform_footage builds its graph from.
$url = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
$zip = Join-Path $env:TEMP 'ffmpeg-release-essentials.zip'
$unpacked = Join-Path $env:TEMP 'ffmpeg-unpacked'

Write-Host "Downloading ffmpeg (~80 MB) from $url"
# Progress rendering makes Invoke-WebRequest many times slower on Windows, and
# an 80 MB download is exactly where that shows.
$ProgressPreference = 'SilentlyContinue'
Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing

Write-Host 'Unpacking'
if (Test-Path $unpacked) { Remove-Item $unpacked -Recurse -Force }
Expand-Archive -Path $zip -DestinationPath $unpacked -Force

# The zip nests everything under a versioned folder, so find the file rather
# than guessing this release's name.
$found = Get-ChildItem -Path $unpacked -Filter 'ffmpeg.exe' -Recurse | Select-Object -First 1
if (-not $found) { throw "no ffmpeg.exe inside $zip" }

Copy-Item $found.FullName $target -Force
Remove-Item $zip -Force
Remove-Item $unpacked -Recurse -Force

Write-Host "Installed: $target"
& $target -version | Select-Object -First 1
Write-Host 'Restart the app and try the upload again.'
