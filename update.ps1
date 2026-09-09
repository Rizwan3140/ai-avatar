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
#
# It follows release tags, not the branch. This script runs at every logon, so
# whatever master pointed at when a cabinet woke up was executed on it — which
# made "can push to master" and "can run code in every showroom" the same
# sentence. A tag is a deliberate act; a push is not. Until the first tag is
# cut there are none to follow, so it says so and falls back to the branch:
# a cabinet that stops updating silently is worse than the thing being fixed.

param(
    # Register a scheduled task so this runs on its own: at logon, and every
    # day at 07:00. Per-user, so it needs no administrator password — which is
    # the whole reason this machine exists as a problem.
    [switch]$Schedule,
    [switch]$Unschedule,
    # Check the release-picking rule without touching the network or this
    # machine. Which tag wins decides what code runs in every showroom, and
    # a plain string sort gets v1.10.0 wrong.
    [switch]$SelfTest
)

$ErrorActionPreference = 'Stop'

function Select-LatestTag($tags) {
    # Version order, not alphabetical: 'v1.9.0' sorts after 'v1.10.0' as text,
    # which would install an older release and say nothing. Anything that is
    # not a plain version is ignored, so a 'nightly' or 'wip-x' tag cannot
    # become what a cabinet runs.
    ($tags |
        Where-Object { $_.name -match '^v?\d+(\.\d+)*$' } |
        Sort-Object { [version]($_.name -replace '^v', '') } -Descending |
        Select-Object -First 1).name
}

if ($SelfTest) {
    $cases = @(
        @{ tags = @('v1.2.0', 'v1.10.0', 'v1.9.0'); want = 'v1.10.0' }
        @{ tags = @('2.0', '10.1');                 want = '10.1' }
        @{ tags = @('nightly', 'v0.9', 'wip-thing');want = 'v0.9' }
        @{ tags = @();                              want = $null }
    )
    $failed = 0
    foreach ($case in $cases) {
        $got = Select-LatestTag ($case.tags | ForEach-Object { [pscustomobject]@{ name = $_ } })
        if ($got -eq $case.want) {
            Write-Host ("  ok    {0} -> {1}" -f ($case.tags -join ','), $case.want)
        } else {
            Write-Host ("  FAIL  {0} -> got '{1}', wanted '{2}'" -f ($case.tags -join ','), $got, $case.want) -ForegroundColor Red
            $failed++
        }
    }
    if ($failed) { exit 1 }
    Write-Host "`n$($cases.Count) passed, 0 failed" -ForegroundColor Green
    return
}

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

# Asked of GitHub rather than of the checkout, because the zip path has no git
# and both need the same answer. Sorted here rather than trusting the order the
# API returns: it is not documented to be newest-first, and picking the wrong
# tag is an old version installed silently.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$tag = $null
$reachable = $false
try {
    $tags = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/tags?per_page=100" `
        -Headers @{ 'User-Agent' = 'luxora-update' } -UseBasicParsing
    $reachable = $true
    $tag = Select-LatestTag $tags
} catch { }

if ($tag) {
    $ref = $tag
    Write-Host "  release: $tag" -ForegroundColor DarkGray
} elseif ($reachable) {
    # GitHub answered and there is no release to follow. This is the state of
    # the repository until the first tag is cut, and a cabinet that stopped
    # updating over it would be a worse bug than the one being fixed.
    $ref = $branch
    Write-Host "  release: none published yet - following '$branch'" -ForegroundColor Yellow
} else {
    # Not the same thing as "no releases". Falling back to the branch whenever
    # the network hiccups would mean any blip put a cabinet back on whatever
    # master points at - which is the entire behaviour this is removing. The
    # machine keeps running what it already has, which is a released version.
    Write-Host "`n  Could not reach GitHub to ask which release is current." -ForegroundColor Yellow
    Write-Host "  Leaving this machine on what it already has." -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

$haveGit = $null -ne (Get-Command git -ErrorAction SilentlyContinue)
$updated = $false

if ($haveGit -and (Test-Path (Join-Path $root '.git'))) {
    Write-Host "  method:  git" -ForegroundColor DarkGray
    # Remote and branch named explicitly. A bare `git pull` needs an upstream,
    # and a checkout built with `git init` + `fetch` + `reset --hard` has none —
    # so it failed with "no tracking information" while the script sailed past,
    # because $ErrorActionPreference does not apply to native commands.
    # On a machine that runs this script, snapshot.json is an input and never
    # an output. Running `snapshot export` here overwrites the shared catalog
    # with this machine's own — and because the file is tracked, it also blocks
    # the next pull. Discard any local edit to it rather than letting one
    # mistaken command wedge every future update.
    git -C $root checkout -- knowledge/snapshot.json 2>$null
    if ($tag) {
        # Detached on purpose: a cabinet never commits, and a branch that
        # tracks a tag is a branch somebody will later push to by accident.
        # --force is not used, so an edited tracked file stops the update
        # rather than being silently discarded - the same direction of wrong
        # as never deleting.
        git -C $root fetch --tags --force origin
        if ($LASTEXITCODE -eq 0) {
            git -C $root checkout --detach "refs/tags/$tag"
        }
    } else {
        git -C $root pull --ff-only origin $branch
        if ($LASTEXITCODE -eq 0) {
            # Set it once so future pulls need no arguments.
            git -C $root branch --set-upstream-to="origin/$branch" $branch 2>$null | Out-Null
        }
    }
    if ($LASTEXITCODE -eq 0) {
        $updated = $true
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
        $path = if ($tag) { "refs/tags/$tag" } else { "refs/heads/$branch" }
        $url = "https://codeload.github.com/$repo/zip/$path"
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
    $head = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/commits/$ref" `
        -Headers @{ 'User-Agent' = 'luxora-update' } -UseBasicParsing
    # No ternary: this runs on Windows PowerShell 5.1, where `?:` is a parse
    # error rather than a missing feature.
    $stamp = "{0} {1} {2} {3}" -f $ref,
                                  $head.sha.Substring(0, 7),
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
