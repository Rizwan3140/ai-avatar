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
#
# Which release is a choice, made at the machine. Luxora.bat asks (-Choose),
# with a line from releases.txt beside each version, and the answer is kept in
# .release: 'latest' follows new releases, a version stays put. The unattended
# logon run reads the same file, so falling back to an older release survives a
# reboot rather than being undone by the next one.

param(
    # Show the version menu. Luxora.bat passes this; the scheduled run does not,
    # because nobody is there to answer it.
    [switch]$Choose,
    # Install this release and remember it: a version such as v1.0.0, or
    # 'latest'. Without it, whatever .release says, and 'latest' if nothing does.
    [string]$Release,
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

function Sort-Releases($names) {
    # Version order, not alphabetical: 'v1.9.0' sorts after 'v1.10.0' as text,
    # which would install an older release and say nothing. Anything that is
    # not a plain version is ignored, so a 'nightly' or 'wip-x' tag cannot
    # become what a cabinet runs.
    @($names |
        Where-Object { $_ -match '^v?\d+(\.\d+)*$' } |
        Sort-Object { [version]($_ -replace '^v', '') } -Descending)
}

function Select-LatestTag($names) {
    Sort-Releases $names | Select-Object -First 1
}

function Resolve-Release($choice, $names) {
    # A remembered version that no longer exists falls back to the newest,
    # rather than leaving the machine unable to update at all.
    if ($choice -and $choice -ne 'latest' -and ((Sort-Releases $names) -contains $choice)) {
        return $choice
    }
    Select-LatestTag $names
}

function Invoke-GitQuietly {
    # Git, with its complaints thrown away and no power to end this script.
    # PowerShell 5.1 turns a native command's redirected stderr into an error
    # record, and under 'Stop' that is fatal - so `git ... 2>$null` asking
    # whether HEAD is on a tag, on a checkout that is not, ended the update
    # right there. $LASTEXITCODE still says whether it worked.
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { git -C $root @args 2>$null } finally { $ErrorActionPreference = $previous }
}

function Restore-Launchers {
    # Working tree only: nothing is staged or committed, so the next switch can
    # put the release's own copies back with a plain checkout.
    if (-not ($haveGit -and $newest)) { return }
    if ((Invoke-GitQuietly describe --tags --exact-match HEAD) -eq $newest) { return }
    Invoke-GitQuietly restore --source="refs/tags/$newest" --worktree -- $launchers
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  (could not keep the version menu - run update.ps1 -Choose to pick again)" -ForegroundColor Yellow
    }
}

function Read-Descriptions($text) {
    # releases.txt: `v2.0.0 | what it is`. A version may have several lines.
    $found = @{}
    foreach ($line in ($text -split "`r?`n")) {
        if ($line -match '^\s*(v?\d+(?:\.\d+)*)\s*\|\s*(.+?)\s*$') {
            if ($found.ContainsKey($matches[1])) {
                $found[$matches[1]] = $found[$matches[1]] + ' ' + $matches[2]
            } else {
                $found[$matches[1]] = $matches[2]
            }
        }
    }
    $found
}

if ($SelfTest) {
    $released = @('v1.0.0', 'v2.0.0', 'v2.1.0')
    $cases = @(
        @{ label = 'newest of v1.2.0,v1.10.0,v1.9.0';  got = (Select-LatestTag @('v1.2.0', 'v1.10.0', 'v1.9.0')); want = 'v1.10.0' }
        @{ label = 'newest of 2.0,10.1';               got = (Select-LatestTag @('2.0', '10.1'));                 want = '10.1' }
        @{ label = 'a nightly tag is not a release';   got = (Select-LatestTag @('nightly', 'v0.9', 'wip-thing')); want = 'v0.9' }
        @{ label = 'no tags, no release';              got = (Select-LatestTag @());                              want = $null }
        @{ label = "'latest' follows the newest";      got = (Resolve-Release 'latest' $released);                want = 'v2.1.0' }
        @{ label = 'nothing saved follows the newest'; got = (Resolve-Release '' $released);                      want = 'v2.1.0' }
        @{ label = 'a chosen version stays put';       got = (Resolve-Release 'v1.0.0' $released);                want = 'v1.0.0' }
        @{ label = 'a vanished version falls forward'; got = (Resolve-Release 'v9.9.9' $released);                want = 'v2.1.0' }
        @{ label = 'a nightly cannot be chosen';       got = (Resolve-Release 'nightly' ($released + 'nightly')); want = 'v2.1.0' }
    )
    $notes = Read-Descriptions "# comment | ignored`nv2.0.0 | Telugu.`n  v2.0.0 |  And Hindi.  `nv1.0.0|English only."
    $cases += @{ label = 'descriptions join their lines'; got = $notes['v2.0.0']; want = 'Telugu. And Hindi.' }
    $cases += @{ label = 'descriptions need no spaces';   got = $notes['v1.0.0']; want = 'English only.' }
    $cases += @{ label = 'comments are not versions';     got = $notes.Count;     want = 2 }
    $failed = 0
    foreach ($case in $cases) {
        if ($case.got -eq $case.want) {
            Write-Host ("  ok    {0} -> {1}" -f $case.label, $case.want)
        } else {
            Write-Host ("  FAIL  {0} -> got '{1}', wanted '{2}'" -f $case.label, $case.got, $case.want) -ForegroundColor Red
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

$haveGit = ($null -ne (Get-Command git -ErrorAction SilentlyContinue)) -and (Test-Path (Join-Path $root '.git'))

# The files that must come from the newest release whatever release runs: the
# menu has to survive choosing a version older than the menu. Luxora.bat is not
# here on purpose - cmd reads a running batch file as it goes, so rewriting it
# mid-run executes whatever now sits at that byte offset.
$launchers = @('start.ps1', 'update.ps1', 'releases.txt')

# Asked of the remote rather than of the checkout. With git, the remote itself;
# without, GitHub's API, because the zip path has no git. Sorted here rather than
# trusting the order either returns: picking the wrong tag is an old version
# installed silently.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$tag = $null
$names = @()
$reachable = $false
if ($haveGit) {
    $listed = Invoke-GitQuietly ls-remote --tags --refs origin
    if ($LASTEXITCODE -eq 0) {
        $reachable = $true
        $names = @($listed | ForEach-Object { ($_ -split 'refs/tags/')[-1] })
        # Fetched now rather than at the checkout, so the menu can read the
        # newest release's descriptions before anything moves.
        Invoke-GitQuietly fetch --tags --force --quiet origin
    }
} else {
    try {
        $tags = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/tags?per_page=100" `
            -Headers @{ 'User-Agent' = 'luxora-update' } -UseBasicParsing
        $reachable = $true
        $names = @($tags | ForEach-Object { $_.name })
    } catch { }
}

$releaseFile = Join-Path $root '.release'
$saved = 'latest'
if (Test-Path $releaseFile) {
    $text = (Get-Content $releaseFile -Raw)
    if ($text -and $text.Trim()) { $saved = $text.Trim() }
}
$newest = Select-LatestTag $names
$releases = Sort-Releases $names

if ($Choose -and $releases.Count -and -not [Console]::IsInputRedirected) {
    # Descriptions come from the newest release's copy of releases.txt, which
    # knows every version before it. The tag's own message is the fallback.
    $notes = @{}
    if ($haveGit) {
        $text = (Invoke-GitQuietly show "refs/tags/${newest}:releases.txt") -join "`n"
        if ($LASTEXITCODE -eq 0) { $notes = Read-Descriptions $text }
    } elseif (Test-Path (Join-Path $root 'releases.txt')) {
        $notes = Read-Descriptions (Get-Content (Join-Path $root 'releases.txt') -Raw)
    }
    $running = ''
    if ($haveGit) { $running = (Invoke-GitQuietly describe --tags --exact-match HEAD) }

    $options = @('latest') + $releases
    Write-Host ""
    Write-Host "  Which version should Luxora run?" -ForegroundColor Cyan
    Write-Host ""
    Write-Host ("    1  Always the newest  (now {0}) - moves up by itself when a new release is published" -f $newest)
    for ($i = 1; $i -lt $options.Count; $i++) {
        $name = $options[$i]
        $about = $notes[$name]
        if (-not $about -and $haveGit) {
            $about = (Invoke-GitQuietly for-each-ref "refs/tags/$name" --format='%(contents:subject)')
        }
        $mark = ''
        if ($name -eq $running) { $mark = '   <- running now' }
        Write-Host ("    {0}  {1,-8} {2}{3}" -f ($i + 1), $name, $about, $mark)
    }
    Write-Host ""
    $keep = $saved
    if ($saved -eq 'latest') { $keep = 'always the newest' }
    Write-Host ("  Press a number. Enter keeps your choice ({0}); so does waiting 20 seconds." -f $keep) -ForegroundColor DarkGray

    $picked = $null
    $deadline = (Get-Date).AddSeconds(20)
    while (-not $picked -and (Get-Date) -lt $deadline) {
        if ([Console]::KeyAvailable) {
            $key = [Console]::ReadKey($true)
            if ($key.Key -eq 'Enter') { $picked = $saved }
            $n = 0
            if ([int]::TryParse([string]$key.KeyChar, [ref]$n) -and $n -ge 1 -and $n -le $options.Count) {
                $picked = $options[$n - 1]
            }
        } else {
            Start-Sleep -Milliseconds 100
        }
    }
    if (-not $picked) { $picked = $saved }
    $Release = $picked
}

if ($Release) {
    # Not Set-Content: PowerShell 5.1 writes a byte-order mark into it.
    [System.IO.File]::WriteAllText($releaseFile, $Release, (New-Object System.Text.UTF8Encoding $false))
    $saved = $Release
}

$tag = Resolve-Release $saved $names

if ($tag) {
    $ref = $tag
    if ($saved -ne 'latest' -and $tag -eq $saved) {
        Write-Host "  release: $tag (chosen - stays here until you pick another)" -ForegroundColor DarkGray
    } else {
        if ($saved -ne 'latest') {
            Write-Host "  release: $saved is not published any more - using $tag" -ForegroundColor Yellow
        }
        Write-Host "  release: $tag (the newest)" -ForegroundColor DarkGray
    }
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

$updated = $false

if ($haveGit) {
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
    Invoke-GitQuietly checkout -- knowledge/snapshot.json
    if ($tag) {
        # Detached on purpose: a cabinet never commits, and a branch that
        # tracks a tag is a branch somebody will later push to by accident.
        # --force is not used, so an edited tracked file stops the update
        # rather than being silently discarded - the same direction of wrong
        # as never deleting.
        #
        # Put back whatever the last run laid over an older release first:
        # start.ps1 and update.ps1 are edits git would refuse to move past, and
        # a releases.txt the older release never tracked is in the way of the
        # one a newer release does. PowerShell parsed this script before running
        # it, so restoring the file on disk does not change what is executing.
        $moved = 1
        try {
            foreach ($file in $launchers) {
                if (Invoke-GitQuietly ls-files -- $file) {
                    Invoke-GitQuietly checkout -- $file
                } elseif (Test-Path (Join-Path $root $file)) {
                    Remove-Item (Join-Path $root $file) -Force
                }
            }
            git -C $root checkout --detach "refs/tags/$tag"
            $moved = $LASTEXITCODE
        } finally {
            # Wherever that left HEAD - moved, refused, or interrupted halfway -
            # a machine not on the newest release keeps the newest launchers.
            # Without this, a switch that died after putting the old ones back
            # ran the old updater next time: no menu, straight to the newest.
            Restore-Launchers
        }
        $global:LASTEXITCODE = $moved
    } else {
        git -C $root pull --ff-only origin $branch
        if ($LASTEXITCODE -eq 0) {
            # Set it once so future pulls need no arguments.
            Invoke-GitQuietly branch --set-upstream-to="origin/$branch" $branch | Out-Null
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
        # The archive carries that release's own launchers; keep the menu.
        Restore-Launchers
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
