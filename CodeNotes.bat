@echo off
REM ============================================================================
REM  CodeNotes - a VDX product  |  ONE-CLICK LAUNCHER  (end-user friendly)
REM
REM  This starts the app and opens Chrome. NO command line needed.
REM  The app runs entirely in your browser. Nothing is installed, nothing compiles.
REM
REM  - Double-click this file. CodeNotes opens in your default browser.
REM  - Optional: live voice transcription needs the local Whisper helper.
REM    Install it once (install.bat), then this launcher starts it too.
REM ============================================================================
setlocal EnableDelayedExpansion
title CodeNotes - a VDX product
set "DIR=%~dp0"

REM --- 1. Start the local Whisper STT helper (only if present and healthy) ---
set "HAS_WHISPER=0"
set "PY=%USERPROFILE%\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe"
if exist "%PY%" (
  where curl >nul 2>nul && curl -s -m 2 -o nul http://127.0.0.1:8010/health && set "HAS_WHISPER=1"
  if "!HAS_WHISPER!"=="0" (
    start "CodeNotes-Whisper" cmd /k ""%PY%" "%DIR%local_stt_server.py" --port 8010"
    set "HAS_WHISPER=1"
  )
)

REM --- 2. Start the web server (if not already running) and open the app ---
start "CodeNotes-Web" cmd /k ""%PY%" -m http.server 8741 --directory "%DIR%""

REM --- 3. Give the server a beat, then open the app in the browser ---
timeout /t 3 >nul
start "" "http://localhost:8741"

echo.
echo  CodeNotes - a VDX product
echo  -------------------------------------
echo  App is open in your browser: http://localhost:8741
if "!HAS_WHISPER!"=="1" (
  echo  Live voice ON  - local Whisper helper is at http://localhost:8010
) else (
  echo  Live voice helper not started - set STT endpoint in Settings if needed.
)
echo  To stop: close the two console windows that opened.
echo.
echo  Note: the app runs 100% in the browser. You can close this window.
exit /b 0
