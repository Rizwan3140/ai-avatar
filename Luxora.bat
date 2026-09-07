@echo off
REM Double-click this to run Luxora.
REM
REM Updates from GitHub, starts the server, opens a Cloudflare tunnel and
REM opens the studio in a browser. Everything a person needs is one file, which
REM is the point: the alternative was four commands typed in the right order
REM from the right folder, and the wrong folder was the single most common
REM failure this install had.
REM
REM %~dp0 is this file's own folder, so it works wherever the project lives and
REM does not care what directory the shell happens to start in.

title Luxora
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" -Open

echo.
echo Press any key to close this window.
echo The server and the tunnel keep running.
pause >nul
