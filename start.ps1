# Bring Luxora all the way up on this machine, from a cold boot.
#
#     powershell -ExecutionPolicy Bypass -File start.ps1              # now
#     powershell -ExecutionPolicy Bypass -File start.ps1 -Schedule    # every logon
#     powershell -ExecutionPolicy Bypass -File start.ps1 -Unschedule
#
# Updates from GitHub, starts the server, opens a Cloudflare tunnel, and writes
# the public link where a person can find it. Per-user throughout, so no
# administrator password is needed anywhere - which is the constraint this whole
# machine has been shaped by.
#
# The link is the reason the tunnel is here at all: it is real HTTPS, and
# `getUserMedia` refuses a plain-http LAN address. A phone opening this URL can
# use its microphone; a phone opening http://192.168.x.x cannot.

param(
    [switch]$Schedule,
    [switch]$Unschedule,
    [switch]$NoTunnel,
    # Opens the studio in a browser once everything answers. On by default when
    # a person double-clicked Luxora.bat, and off for the scheduled run, which
    # has nobody sitting in front of it.
    [switch]$Open,
    [int]$Port = 8000
)

$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
$taskName = 'Luxora start'
$linkFile = Join-Path $root 'tunnel-url.txt'
$tunnelLog = Join-Path $root 'tunnel.log'
$serverLog = Join-Path $root 'server.log'

if ($Unschedule) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "`nLuxora will no longer start itself." -ForegroundColor Yellow
    return
}

if ($Schedule) {
    $self = Join-Path $root 'start.ps1'
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
        -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$self`""
    # At logon, with a delay. A cold machine has no network for the first few
    # seconds, and an update that starts before the adapter is up fails for a
    # reason that has nothing to do with anything.
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $trigger.Delay = 'PT45S'
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
        -Settings $settings -Description 'Update, serve and publish Luxora' -Force | Out-Null
    Write-Host "`nLuxora will start itself at every logon." -ForegroundColor Green
    Write-Host "  The public link is written to: $linkFile"
    Write-Host "  Stop this with:  .\start.ps1 -Unschedule"
    return
}

Write-Host "`nLuxora" -ForegroundColor Cyan

# --- clear out a previous run -------------------------------------------------
# Matched on path, so this never touches an unrelated python somebody is using
# for something else on the same machine.
foreach ($name in @('python', 'cloudflared')) {
    Get-Process -Name $name -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and $_.Path.StartsWith($root, 'OrdinalIgnoreCase') } |
        Stop-Process -Force -ErrorAction SilentlyContinue
}

# --- 1. update ----------------------------------------------------------------
# Never fatal. A machine that cannot reach GitHub should still come up on the
# code it already has, rather than not coming up at all.
$updater = Join-Path $root 'update.ps1'
if (Test-Path $updater) {
    Write-Host "`n[1/3] updating" -ForegroundColor Cyan
    & powershell -NoProfile -ExecutionPolicy Bypass -File $updater
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  update did not complete - starting on the existing code" -ForegroundColor Yellow
    }
}

# --- 2. the server ------------------------------------------------------------
Write-Host "`n[2/3] starting the server" -ForegroundColor Cyan
$py = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path $py)) {
    Write-Host "  no .venv here. Run this first:" -ForegroundColor Red
    Write-Host "    python -m venv .venv"
    Write-Host "    .\.venv\Scripts\python.exe -m pip install -r requirements.txt"
    exit 1
}

Start-Process -FilePath $py `
    -ArgumentList '-m', 'uvicorn', 'backend.main:app', '--port', "$Port" `
    -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput $serverLog -RedirectStandardError "$serverLog.err"

# Wait for it to actually answer rather than assuming. Whisper loads at boot and
# a cold start is about eleven seconds, so the tunnel must not go up in front of
# a server that is not serving yet.
$ready = $false
foreach ($i in 1..40) {
    Start-Sleep -Seconds 1
    try {
        $r = Invoke-WebRequest "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 3
        if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch { }
}
if (-not $ready) {
    Write-Host "  the server did not answer in 40s. See $serverLog.err" -ForegroundColor Red
    exit 1
}
Write-Host "  serving on http://localhost:$Port" -ForegroundColor Green

# Locally, not through the tunnel. `localhost` is a secure context in its own
# right, so the microphone works here too — and it does not depend on the
# tunnel having come up.
if ($Open) { Start-Process "http://localhost:$Port/" }

if ($NoTunnel) { return }

# --- 3. the tunnel ------------------------------------------------------------
Write-Host "`n[3/3] publishing" -ForegroundColor Cyan
$cf = Join-Path $root 'cloudflared.exe'
if (-not (Test-Path $cf)) {
    Write-Host "  cloudflared.exe is not here - downloading it once" -ForegroundColor DarkGray
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' `
        -OutFile $cf -UseBasicParsing
}

Remove-Item $tunnelLog -ErrorAction SilentlyContinue
Start-Process -FilePath $cf `
    -ArgumentList 'tunnel', '--url', "http://localhost:$Port" `
    -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput "$tunnelLog.out" -RedirectStandardError $tunnelLog

# cloudflared prints the address once, on stderr, a few seconds in. Read it back
# rather than asking the person to find it in a log.
$url = ''
foreach ($i in 1..40) {
    Start-Sleep -Seconds 1
    if (Test-Path $tunnelLog) {
        $m = Select-String -Path $tunnelLog -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue |
             Select-Object -First 1
        if ($m) { $url = $m.Matches[0].Value; break }
    }
}

if ($url) {
    Set-Content -Path $linkFile -Value $url -Encoding ascii
    Write-Host ""
    Write-Host "  $url" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Saved to $linkFile"
    Write-Host "  Open it on a phone - it is real HTTPS, so the microphone works."
    Write-Host "  A LAN address over plain http does not get a microphone."
} else {
    Write-Host "  the tunnel did not report an address. See $tunnelLog" -ForegroundColor Yellow
    Write-Host "  The server is still up on http://localhost:$Port" -ForegroundColor DarkGray
}
