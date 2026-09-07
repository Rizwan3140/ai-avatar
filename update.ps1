# Pull the latest Luxora onto a machine that cannot build it.
#
#     powershell -ExecutionPolicy Bypass -File update.ps1
#
# Run it from the project folder. It needs no administrator password, and no
# git — it will use git if it finds it, and fall back to downloading the
# repository as a zip if it does not.
#
# What it will never touch, because none of it is in the repository to begin
# with: .env, knowledge\ (the catalog, the accounts, the event log) and
# frontend\public\avatars\ (the footage). A GitHub archive contains tracked
# files only, so the things that make this install yours are safe by
# construction rather than by a list here that somebody has to remember to
# update.
#
# It does not delete. A file removed upstream stays on this machine until
# somebody removes it — the safe direction to be wrong in.

$ErrorActionPreference = 'Stop'
$repo = 'Rizwan3140/ai-avatar'
$branch = 'master'
$root = $PSScriptRoot

Write-Host ""
Write-Host "Luxora update" -ForegroundColor Cyan
Write-Host "  project: $root"

# requirements.txt is compared before and after, because a pull that adds a
# dependency and does not say so fails later as an ImportError, a long way from
# the thing that caused it.
$reqPath = Join-Path $root 'requirements.txt'
$reqBefore = if (Test-Path $reqPath) { (Get-FileHash $reqPath).Hash } else { '' }

$haveGit = $null -ne (Get-Command git -ErrorAction SilentlyContinue)

if ($haveGit -and (Test-Path (Join-Path $root '.git'))) {
    Write-Host "  method:  git pull" -ForegroundColor DarkGray
    git -C $root pull --ff-only
} else {
    Write-Host "  method:  zip download (no git here)" -ForegroundColor DarkGray

    # PowerShell 5.1 still negotiates TLS 1.0 by default, which GitHub refuses.
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

    $tmp = Join-Path $env:TEMP ("luxora-update-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tmp -Force | Out-Null
    try {
        $zip = Join-Path $tmp 'repo.zip'
        $url = "https://codeload.github.com/$repo/zip/refs/heads/$branch"
        Write-Host "  fetching $url"
        Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing

        Expand-Archive -Path $zip -DestinationPath $tmp -Force
        # GitHub wraps everything in one folder named for the repo and branch.
        $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
        if (-not $inner) { throw "the archive did not contain a folder" }

        Copy-Item -Path (Join-Path $inner.FullName '*') -Destination $root -Recurse -Force
        Write-Host "  copied over the project"
    } finally {
        Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
}

$reqAfter = if (Test-Path $reqPath) { (Get-FileHash $reqPath).Hash } else { '' }

Write-Host ""
if ($reqBefore -ne $reqAfter) {
    Write-Host "  requirements.txt changed - install them:" -ForegroundColor Yellow
    Write-Host "    .\.venv\Scripts\python.exe -m pip install -r requirements.txt"
    Write-Host ""
}

Write-Host "Updated. Restart the server:" -ForegroundColor Green
Write-Host "  .\.venv\Scripts\python.exe -m uvicorn backend.main:app --port 8000"
Write-Host ""
Write-Host "Then hard-refresh the browser with Ctrl+F5 - the bundle filename"
Write-Host "changes on every build, and a cached page looks exactly like an"
Write-Host "update that did not arrive."
Write-Host ""
