@echo off
REM ============================================================================
REM  CodeNotes - a VDX product  |  one-click Windows launcher
REM  Boots the local Whisper STT server + the web app, then opens your browser.
REM  Usage:  double-click  start-codenotes.bat   (after running install.bat once)
REM ============================================================================
setlocal
set "DIR=%~dp0"
REM Prefer a local .venv created by install.bat; fall back to system python.
set "PY=%DIR%.venv\Scripts\python.exe"
if not exist "%PY%" set "PY=python"

echo [I] Starting local Whisper STT on http://localhost:8010 ...
start "CodeNotes-Whisper" cmd /k ""%PY%" "%DIR%local_stt_server.py" --port 8010"

echo [I] Starting CodeNotes web app on http://localhost:8741 ...
start "CodeNotes-App" cmd /k ""%PY%" -m http.server 8741 --directory "%DIR%""

timeout /t 4 >nul
echo [I] Opening browser...
start "" "http://localhost:8741"
echo.
echo CodeNotes running:
echo   App:  http://localhost:8741
echo   STT:  http://localhost:8010/v1/audio/transcriptions
echo Set the STT endpoint in Settings to point at the local Whisper server.
echo Close the two "cmd" windows to stop.
pause
