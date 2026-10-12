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

REM Then it stays, and watches. A fix goes into the version that is already
REM out, so the version this machine is running can change on GitHub without
REM its name changing - and until this window did the looking, picking that up
REM meant remembering to close it and double-click again. It reloads by itself
REM now, and leaves the tunnel alone, so the link sent to a panel keeps working.
REM
REM Everything above this line is kept byte for byte as it was. cmd reads a
REM batch file a line at a time from where it left off, and the update this
REM file starts replaces this file while it is running: a copy that grew above
REM here would be resumed in the middle of a sentence.
REM
REM Runs until this window is closed. The server and the tunnel were started on
REM their own and outlive it.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" -Watch
