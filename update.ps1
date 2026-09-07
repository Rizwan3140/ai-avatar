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

param(
    # Register a scheduled task so this runs on its own: at logon, and every
    # day at 07:00. Per-user, so it needs no administrator password — which is
    # the whole reason this machine exists as a problem.
    [switch]$Schedule,
    [switch]$Unschedule
)

$ErrorActionPreference = 'Stop'
$repo = 'Rizwan3140/ai-avatar'
$branch = 'master'
$root = $PSScriptRoot
$taskName = 'Luxora update'

if ($Unschedule) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "`nAutomatic updates off." -ForegroundColor Yellow
    return
}

if ($Schedule) {
    $self = Join-Path $root 'update.ps1'
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
        -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$self`""
    $triggers = @(
        New-ScheduledTaskTrigger -AtLogOn
        New-ScheduledTaskTrigger -Daily -At 7am
    )
    # Run whether or not the machine is on mains, and do not stop it halfway
    # through a copy because a laptop went to battery.
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries -StartWhenAvailable
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers `
        -Settings $settings -Description 'Pull the latest Luxora from GitHub' -Force | Out-Null
    Write-Host "`nAutomatic updates on: at logon, and daily at 07:00." -ForegroundColor Green
    Write-Host "  Turn off with:  .\update.ps1 -Unschedule"
    Write-Host "  It only copies files. A running server keeps serving the old"
    Write-Host "  Python until you restart it; the interface updates on refresh."
    return
}

Write-Host ""
Write-Host "Luxora update" -ForegroundColor Cyan
Write-Host "  project: $root"

# requirements.txt is compared before and after, because a pull that adds a
# dependency and does not say so fails later as an ImportError, a long way from
# the thing that caused it.
$reqPath = Join-Path $root 'requirements.txt'
$reqBefore = if (Test-Path $reqPath) { (Get-FileHash $reqPath).Hash } else { '' }

$haveGit = $null -ne (Get-Command git -ErrorAction SilentlyContinue)
$updated = $false

if ($haveGit -and (Test-Path (Join-Path $root '.git'))) {
    Write-Host "  method:  git pull" -ForegroundColor DarkGray
    # Remote and branch named explicitly. A bare `git pull` needs an upstream,
    # and a checkout built with `git init` + `fetch` + `reset --hard` has none —
    # so it failed with "no tracking information" while the script sailed past,
    # because $ErrorActionPreference does not apply to native commands.
    git -C $root pull --ff-only origin $branch
    if ($LASTEXITCODE -eq 0) {
        $updated = $true
        # Set it once so future pulls need no arguments.
        git -C $root branch --set-upstream-to="origin/$branch" $branch 2>$null | Out-Null
    } else {
        Write-Host "  git pull failed - falling back to the zip download" -ForegroundColor Yellow
    }
}

if (-not $updated) {
    Write-Host "  method:  zip download" -ForegroundColor DarkGray

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
        $updated = $true
        Write-Host "  copied over the project"
    } finally {
        Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
}

if (-not $updated) {
    Write-Host "`nNothing was updated. Leaving the version marker alone rather" -ForegroundColor Red
    Write-Host "than claiming a version this machine is not running." -ForegroundColor Red
    exit 1
}

$reqAfter = if (Test-Path $reqPath) { (Get-FileHash $reqPath).Hash } else { '' }

# Data does not travel in the files above - the catalog and the company name
# live in a database that is deliberately never tracked, because it also holds
# password hashes and this repository is public. `snapshot.json` is the narrow,
# safe half of it: products and display names, nothing else. Applying it here is
# what makes "change it there, it changes here" true of data as well as code.
$py = Join-Path $root '.venv\Scripts\python.exe'
if (Test-Path $py) {
    & $py -m backend.snapshot apply
} else {
    Write-Host "  (no .venv yet - run the snapshot apply after installing)" -ForegroundColor DarkGray
}

# Record what landed, so /api/health can answer "am I current" instead of
# leaving somebody to infer it from behaviour. Written after the copy, never
# before: a marker claiming a version the files do not match is worse than no
# marker, because it is believed.
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $head = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/commits/$branch" `
        -Headers @{ 'User-Agent' = 'luxora-update' } -UseBasicParsing
    $stamp = "{0} {1} {2}" -f $head.sha.Substring(0, 7),
                              (Get-Date -Format 'yyyy-MM-dd HH:mm'),
                              $head.commit.message.Split("`n")[0]
    # Not Set-Content -Encoding utf8: on PowerShell 5.1 that writes a
    # byte-order mark, and the mark ends up inside the version string.
    [System.IO.File]::WriteAllText(
        (Join-Path $root '.version'), $stamp, (New-Object System.Text.UTF8Encoding $false))
    Write-Host "  now at: $stamp" -ForegroundColor DarkGray
} catch {
    Write-Host "  (could not record the version - the update itself was fine)" -ForegroundColor DarkGray
}

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
