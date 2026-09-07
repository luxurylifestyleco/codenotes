@echo off
REM ============================================================================
REM  CodeNotes - a VDX product  |  one-click Windows launcher
REM  Boots the local Whisper STT server + the web app, then opens your browser.
REM  Usage:  double-click  CodeNotes.bat   (after running install.bat once)
REM ============================================================================
setlocal EnableDelayedExpansion
title CodeNotes - a VDX product
set "DIR=%~dp0"

REM --- 1. Find python: prefer the CodeNotes local venv, else system python ---
set "PY=%DIR%.venv\Scripts\python.exe"
if not exist "%PY%" set "PY=python"
where !PY! >nul 2>nul || set "PY=python"

REM --- 2. Start the local Whisper STT helper (optional, only if it can run) ---
set "HAS_WHISPER=0"
"%PY%" -c "import sys; sys.exit(0)" >nul 2>nul
if not errorlevel 1 (
  start "CodeNotes-Whisper" cmd /k ""%PY%" "%DIR%local_stt_server.py" --port 8010"
  set "HAS_WHISPER=1"
)

REM --- 3. Start the web server and open the app ---
start "CodeNotes-Web" cmd /k ""%PY%" -m http.server 8741 --directory "%DIR%""
timeout /t 3 >nul
start "" "http://localhost:8741"

echo.
echo  CodeNotes - a VDX product
echo  -------------------------------------
echo  App open in your browser: http://localhost:8741
if "!HAS_WHISPER!"=="1" (
  echo  Live voice ON - local Whisper helper: http://localhost:8010
) else (
  echo  Live voice helper could not start - use imported transcripts instead.
)
echo  To stop, close the console windows that opened.
echo.
echo  The app runs 100%% in the browser. You can close this window.
exit /b 0
